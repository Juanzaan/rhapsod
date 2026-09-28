// Rhapsod Dashboard for Windows: a tray app that keeps the SSH tunnel to the
// bot host open, reconnects it when it drops, shows what is playing and
// opens the panel in its own window. Nothing about the host or the
// credentials is compiled in: settings live in %APPDATA%\Rhapsod\dashboard.conf
// and the panel password in the Windows Credential Manager.
//
// Written for the C# 5 compiler that ships with .NET Framework 4, so it builds
// on any Windows machine without an SDK: see build.ps1.
//
//   RhapsodDashboard.exe                  start (first run asks for settings)
//   RhapsodDashboard.exe --setup          open the settings dialog first
//   RhapsodDashboard.exe --forget         delete the saved password and exit
//   RhapsodDashboard.exe --self-test FILE non-UI checks for CI; report to FILE

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Rhapsod Dashboard")]
[assembly: System.Reflection.AssemblyProduct("Rhapsod Dashboard")]
[assembly: System.Reflection.AssemblyVersion("2.0.0.0")]

namespace RhapsodDashboard
{
    internal static class Program
    {
        private const string InstanceMutex = "Local\\RhapsodDashboard.Instance";
        private const string OpenPanelEvent = "Local\\RhapsodDashboard.OpenPanel";

        [STAThread]
        private static int Main(string[] args)
        {
            var selfTest = Array.IndexOf(args, "--self-test");
            if (selfTest >= 0)
            {
                return SelfTest(selfTest + 1 < args.Length ? args[selfTest + 1] : "self-test.txt");
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            // UI-thread errors are logged and shown instead of closing the
            // app; anything else is at least logged before the process ends.
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
            {
                Log(e.Exception);
                MessageBox.Show("Error inesperado: " + e.Exception.Message + Environment.NewLine +
                    "Detalle en " + LogPath, "Rhapsod", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            };
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                Log(e.ExceptionObject as Exception);
            };

            if (Array.IndexOf(args, "--forget") >= 0)
            {
                var saved = Settings.Load(Settings.DefaultFilePath);
                var deleted = saved != null && saved.IsComplete && CredentialStore.Delete(saved.CredentialTarget);
                MessageBox.Show(deleted ? "Contraseña guardada eliminada." : "No había una contraseña guardada.", "Rhapsod");
                return 0;
            }

            bool firstInstance;
            using (var mutex = new Mutex(true, InstanceMutex, out firstInstance))
            {
                if (!firstInstance)
                {
                    // Already running: ask that instance to show the panel.
                    EventWaitHandle signal;
                    if (EventWaitHandle.TryOpenExisting(OpenPanelEvent, out signal))
                    {
                        using (signal) signal.Set();
                    }
                    return 0;
                }

                // Created before the settings dialog: a second launch while
                // the first-run dialog is open must find it. A request that
                // arrives early stays signaled and opens the panel once the
                // tray starts.
                using (var openRequests = new EventWaitHandle(false, EventResetMode.AutoReset, OpenPanelEvent))
                {
                    var settings = Settings.Load(Settings.DefaultFilePath);
                    var password = settings != null && settings.IsComplete ? CredentialStore.Read(settings.CredentialTarget) : null;
                    if (settings == null || !settings.IsComplete || password == null || Array.IndexOf(args, "--setup") >= 0)
                    {
                        using (var form = new SettingsForm(settings ?? new Settings(), password != null))
                        {
                            if (form.ShowDialog() != DialogResult.OK) return 0;
                            var previous = settings;
                            settings = form.Result;
                            password = form.NewPassword ?? password;
                            SaveSettings(settings, password, previous);
                        }
                    }

                    var app = new TrayApp(settings, password);
                    ThreadPool.RegisterWaitForSingleObject(openRequests,
                        delegate { app.OpenPanelFromOtherInstance(); }, null, Timeout.Infinite, false);
                    Application.Run(app);
                }
                GC.KeepAlive(mutex);
            }
            return 0;
        }

        public static string LogPath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Rhapsod",
                    "dashboard.log");
            }
        }

        public static void Log(Exception error)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                File.AppendAllText(LogPath, DateTime.Now.ToString("s") + " " + error + Environment.NewLine);
            }
            catch (Exception)
            {
                // Nowhere else to report it.
            }
        }

        public static void SaveSettings(Settings settings, string password, Settings previous)
        {
            settings.Save(Settings.DefaultFilePath);
            try
            {
                CredentialStore.Write(settings.CredentialTarget, settings.PanelUser, password);
                // The credential is keyed by host: a host change would leave
                // the old password where --forget can no longer find it.
                if (previous != null && previous.IsComplete && previous.CredentialTarget != settings.CredentialTarget)
                {
                    CredentialStore.Delete(previous.CredentialTarget);
                }
            }
            catch (Win32Exception error)
            {
                // Policy can disable saved credentials: keep it for this run.
                MessageBox.Show("No se pudo guardar la contraseña (" + error.Message + "). Se usará solo en esta sesión.",
                    "Rhapsod", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        // Exercises the non-UI parts so CI can verify a build: settings round
        // trip, port validation, that a plain HTTP server on the local port is
        // not mistaken for the panel, and the clipboard and menu text helpers.
        private static int SelfTest(string reportPath)
        {
            var report = new List<string>();
            var ok = true;
            Action<string, bool> check = delegate(string name, bool passed)
            {
                report.Add((passed ? "ok   " : "FAIL ") + name);
                if (!passed) ok = false;
            };
            try
            {
                var file = Path.Combine(Path.GetTempPath(), "rhapsod-self-test-" + Guid.NewGuid().ToString("N") + ".conf");
                var original = new Settings
                {
                    Host = "rhapsod@203.0.113.10",
                    KeyPath = "%USERPROFILE%\\.ssh\\id_ed25519",
                    LocalPort = 18080,
                    RemotePort = 8080,
                    PanelUser = "owner",
                };
                original.Save(file);
                var loaded = Settings.Load(file);
                File.Delete(file);
                check("settings round trip", loaded != null && loaded.Host == original.Host &&
                    loaded.KeyPath == original.KeyPath && loaded.LocalPort == 18080 &&
                    loaded.RemotePort == 8080 && loaded.PanelUser == "owner");
                int port;
                check("port validation", Settings.TryPort("8080", out port) && !Settings.TryPort("0", out port) &&
                    !Settings.TryPort("70000", out port) && !Settings.TryPort("abc", out port));

                var listener = new HttpListener();
                var free = FreePort();
                listener.Prefixes.Add("http://127.0.0.1:" + free + "/");
                listener.Start();
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        var context = listener.GetContext();
                        context.Response.StatusCode = 200;
                        context.Response.Close();
                    }
                    catch (HttpListenerException)
                    {
                        // Listener stopped.
                    }
                });
                check("foreign service is not the panel", !PanelClient.LooksLikePanel(free));
                listener.Stop();
                check("closed port is not open", !PortProbe.IsOpen(FreePort()));
                check("menu text keeps ampersands", TrayApp.MenuText("Simon & Garfunkel") == "Simon && Garfunkel");
                var secret = TrayApp.SecretClipboardData("s3cret");
                check("password stays out of clipboard history",
                    (string)secret.GetData(DataFormats.UnicodeText) == "s3cret" &&
                    IsZeroDword(secret, "ExcludeClipboardContentFromMonitorProcessing") &&
                    IsZeroDword(secret, "CanIncludeInClipboardHistory") &&
                    IsZeroDword(secret, "CanUploadToCloudClipboard"));
            }
            catch (Exception error)
            {
                report.Add("FAIL exception: " + error);
                ok = false;
            }
            File.WriteAllLines(reportPath, report);
            return ok ? 0 : 1;
        }

        private static bool IsZeroDword(IDataObject data, string format)
        {
            var stream = data.GetData(format) as MemoryStream;
            return stream != null && stream.Length == 4 && BitConverter.ToInt32(stream.ToArray(), 0) == 0;
        }

        private static int FreePort()
        {
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            var port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();
            return port;
        }
    }
}
