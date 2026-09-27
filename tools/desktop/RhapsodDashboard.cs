// Rhapsod Dashboard launcher for Windows.
//
// Opens an SSH tunnel to the bot host, waits for the panel port, opens the
// browser and copies the panel password to the clipboard. Nothing about the
// host or the credentials is compiled in: the connection settings live in
// %APPDATA%\Rhapsod\dashboard.conf and the panel password in the Windows
// Credential Manager (encrypted per Windows user).
//
// Written for the C# 5 compiler that ships with .NET Framework 4, so it builds
// on any Windows machine without an SDK: see build.ps1.
//
// Usage:
//   RhapsodDashboard.exe            connect (first run asks for settings)
//   RhapsodDashboard.exe --setup    ask for every setting again
//   RhapsodDashboard.exe --forget   delete the saved password and exit

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Rhapsod Dashboard")]
[assembly: System.Reflection.AssemblyProduct("Rhapsod Dashboard")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace RhapsodDashboard
{
    internal sealed class Settings
    {
        public string Host = "";
        public string KeyPath = "";
        public int LocalPort = 8080;
        public int RemotePort = 8080;
        public string PanelUser = "admin";

        public static string FilePath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Rhapsod",
                    "dashboard.conf");
            }
        }

        public static Settings Load()
        {
            if (!File.Exists(FilePath)) return null;
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in File.ReadAllLines(FilePath))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                values[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            var settings = new Settings();
            string value;
            if (values.TryGetValue("host", out value)) settings.Host = value;
            if (values.TryGetValue("key", out value)) settings.KeyPath = value;
            if (values.TryGetValue("panel_user", out value)) settings.PanelUser = value;
            int port;
            if (values.TryGetValue("local_port", out value) && int.TryParse(value, out port)) settings.LocalPort = port;
            if (values.TryGetValue("remote_port", out value) && int.TryParse(value, out port)) settings.RemotePort = port;
            return settings.Host.Length > 0 && settings.KeyPath.Length > 0 ? settings : null;
        }

        public void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
            File.WriteAllLines(FilePath, new[]
            {
                "# Rhapsod Dashboard settings. Edit here or run with --setup.",
                "host=" + Host,
                "key=" + KeyPath,
                "local_port=" + LocalPort,
                "remote_port=" + RemotePort,
                "panel_user=" + PanelUser,
            });
        }

        public string CredentialTarget
        {
            get { return "Rhapsod Dashboard/" + Host; }
        }
    }

    // Windows Credential Manager through advapi32; the secret is stored as a
    // generic credential scoped to the current Windows user.
    internal static class CredentialStore
    {
        private const int CRED_TYPE_GENERIC = 1;
        private const int CRED_PERSIST_LOCAL_MACHINE = 2;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct CREDENTIAL
        {
            public int Flags;
            public int Type;
            public string TargetName;
            public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public int CredentialBlobSize;
            public IntPtr CredentialBlob;
            public int Persist;
            public int AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias;
            public string UserName;
        }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWriteW(ref CREDENTIAL credential, int flags);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredDeleteW(string target, int type, int flags);

        [DllImport("advapi32.dll")]
        private static extern void CredFree(IntPtr buffer);

        public static string Read(string target)
        {
            IntPtr pointer;
            if (!CredReadW(target, CRED_TYPE_GENERIC, 0, out pointer)) return null;
            try
            {
                var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
                if (credential.CredentialBlobSize == 0) return "";
                return Marshal.PtrToStringUni(credential.CredentialBlob, credential.CredentialBlobSize / 2);
            }
            finally
            {
                CredFree(pointer);
            }
        }

        public static void Write(string target, string user, string secret)
        {
            var bytes = Encoding.Unicode.GetBytes(secret);
            var blob = Marshal.AllocHGlobal(bytes.Length);
            try
            {
                Marshal.Copy(bytes, 0, blob, bytes.Length);
                var credential = new CREDENTIAL
                {
                    Type = CRED_TYPE_GENERIC,
                    TargetName = target,
                    CredentialBlobSize = bytes.Length,
                    CredentialBlob = blob,
                    Persist = CRED_PERSIST_LOCAL_MACHINE,
                    UserName = user,
                };
                if (!CredWriteW(ref credential, 0))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }
            }
            finally
            {
                Marshal.FreeHGlobal(blob);
            }
        }

        public static bool Delete(string target)
        {
            return CredDeleteW(target, CRED_TYPE_GENERIC, 0);
        }
    }

    // A Windows job object with KILL_ON_JOB_CLOSE: when this process exits for
    // any reason (Q, Ctrl+C, the window's close button, a crash), the kernel
    // closes the job handle and kills every process assigned to it.
    internal static class ChildProcessJob
    {
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        // Kept for the life of the process on purpose: the handle closing at
        // exit is what triggers the kill.
        private static IntPtr job = IntPtr.Zero;

        public static void Attach(Process process)
        {
            try
            {
                if (job == IntPtr.Zero)
                {
                    var created = CreateJobObjectW(IntPtr.Zero, null);
                    if (created == IntPtr.Zero) return;
                    var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    var size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                    var buffer = Marshal.AllocHGlobal(size);
                    try
                    {
                        Marshal.StructureToPtr(limits, buffer, false);
                        if (!SetInformationJobObject(created, JobObjectExtendedLimitInformation, buffer, (uint)size)) return;
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(buffer);
                    }
                    job = created;
                }
                AssignProcessToJobObject(job, process.Handle);
            }
            catch (Exception)
            {
                // Best effort: without the job, Q and Ctrl+C still stop ssh.
            }
        }
    }

    internal static class Program
    {
        private static Process tunnel;

        [STAThread]
        private static int Main(string[] args)
        {
            Console.Title = "Rhapsod Dashboard";
            Console.WriteLine("  RHAPSOD DASHBOARD");
            Console.WriteLine("  =================");
            Console.WriteLine();

            var setup = Array.IndexOf(args, "--setup") >= 0;
            var forget = Array.IndexOf(args, "--forget") >= 0;

            var settings = setup ? null : Settings.Load();
            if (forget)
            {
                if (settings != null && CredentialStore.Delete(settings.CredentialTarget))
                {
                    Console.WriteLine("  Saved password deleted.");
                }
                else
                {
                    Console.WriteLine("  No saved password found.");
                }
                return 0;
            }
            if (settings == null)
            {
                settings = AskSettings(Settings.Load() ?? new Settings());
                settings.Save();
                Console.WriteLine("  Settings saved to " + Settings.FilePath);
                Console.WriteLine();
            }

            var password = CredentialStore.Read(settings.CredentialTarget);
            if (password == null || setup)
            {
                password = ReadSecret("  Panel password for " + settings.PanelUser + " (hidden): ");
                if (password.Length > 0)
                {
                    try
                    {
                        CredentialStore.Write(settings.CredentialTarget, settings.PanelUser, password);
                        Console.WriteLine("  Password saved in Windows Credential Manager.");
                    }
                    catch (Win32Exception error)
                    {
                        // Policy can disable saved credentials: use the
                        // password for this session instead of failing.
                        Console.WriteLine("  Could not save the password (" + error.Message + "); using it for this session only.");
                    }
                }
            }

            var ssh = FindSsh();
            if (ssh == null)
            {
                return Fail("ssh.exe not found. Install the Windows OpenSSH client or Git for Windows.");
            }
            var key = Environment.ExpandEnvironmentVariables(settings.KeyPath);
            if (!File.Exists(key))
            {
                return Fail("SSH key not found at: " + key + Environment.NewLine +
                    "  That key is what authenticates you to the bot host. Run with --setup to change it.");
            }

            if (PortOpen(settings.LocalPort))
            {
                // Only reuse the port when it answers like the panel: another
                // program on 8080 must not receive the browser and the password.
                if (!LooksLikePanel(settings.LocalPort))
                {
                    return Fail("Port " + settings.LocalPort + " is used by another program, not the Rhapsod panel." +
                        Environment.NewLine + "  Close that program or pick another local port with --setup.");
                }
                Console.WriteLine("  Tunnel already open on port " + settings.LocalPort + ", reusing it.");
            }
            else
            {
                Console.WriteLine("  Opening SSH tunnel to " + settings.Host + "...");
                var error = StartTunnel(ssh, key, settings);
                if (error != null) return Fail(error);
                Console.WriteLine("  Tunnel is up.");
            }

            var url = "http://127.0.0.1:" + settings.LocalPort + "/";
            OpenBrowser(url);
            if (!string.IsNullOrEmpty(password))
            {
                Console.WriteLine();
                Console.WriteLine("  Log in with user " + settings.PanelUser + ".");
                Console.WriteLine(CopyToClipboard(password)
                    ? "  Password copied to clipboard."
                    : "  Could not reach the clipboard; the password is in Windows Credential Manager.");
            }

            Console.WriteLine();
            Console.WriteLine(tunnel != null
                ? "  Keep this window open. Closing it shuts the tunnel."
                : "  The tunnel belongs to another launcher window.");
            Console.WriteLine("  Press Q or Ctrl+C to quit.");
            Console.CancelKeyPress += delegate { StopTunnel(); };
            // Clipboard history and cloud sync keep whatever sits there, so the
            // password is cleared once the login had time to happen.
            var clearClipboardAt = string.IsNullOrEmpty(password) ? DateTime.MaxValue : DateTime.UtcNow.AddSeconds(30);
            while (true)
            {
                if (tunnel != null && tunnel.HasExited)
                {
                    ClearClipboardIfHolding(password);
                    return Fail("The tunnel dropped. Close and reopen this launcher.");
                }
                if (DateTime.UtcNow >= clearClipboardAt)
                {
                    ClearClipboardIfHolding(password);
                    clearClipboardAt = DateTime.MaxValue;
                }
                if (!Console.IsInputRedirected && Console.KeyAvailable && Console.ReadKey(true).Key == ConsoleKey.Q)
                {
                    ClearClipboardIfHolding(password);
                    StopTunnel();
                    return 0;
                }
                Thread.Sleep(250);
            }
        }

        private static Settings AskSettings(Settings current)
        {
            Console.WriteLine("  First-time setup. Press Enter to keep the value in brackets.");
            current.Host = Ask("  SSH target (user@host)", current.Host);
            var defaultKey = current.KeyPath.Length > 0
                ? current.KeyPath
                : Path.Combine("%USERPROFILE%", ".ssh", "id_ed25519");
            current.KeyPath = Ask("  SSH private key", defaultKey);
            current.PanelUser = Ask("  Panel user", current.PanelUser);
            current.LocalPort = AskPort("  Local port", current.LocalPort);
            current.RemotePort = AskPort("  Panel port on the host", current.RemotePort);
            return current;
        }

        private static string Ask(string label, string fallback)
        {
            while (true)
            {
                Console.Write(fallback.Length > 0 ? label + " [" + fallback + "]: " : label + ": ");
                var line = Console.ReadLine();
                if (line == null)
                {
                    // End of input with nothing to fall back on: stop asking.
                    if (fallback.Length > 0) return fallback;
                    throw new InvalidOperationException("Input ended before " + label.Trim() + " was given.");
                }
                var input = line.Trim();
                if (input.Length > 0) return input;
                if (fallback.Length > 0) return fallback;
            }
        }

        private static int AskPort(string label, int fallback)
        {
            while (true)
            {
                int port;
                var input = Ask(label, fallback.ToString());
                if (int.TryParse(input, out port) && port > 0 && port < 65536) return port;
                Console.WriteLine("  Enter a port between 1 and 65535.");
            }
        }

        private static string ReadSecret(string label)
        {
            Console.Write(label);
            if (Console.IsInputRedirected)
            {
                // Piped input (scripts, CI): ReadKey would throw.
                var line = Console.ReadLine() ?? "";
                Console.WriteLine();
                return line;
            }
            var secret = new StringBuilder();
            while (true)
            {
                var key = Console.ReadKey(true);
                if (key.Key == ConsoleKey.Enter) break;
                if (key.Key == ConsoleKey.Backspace)
                {
                    if (secret.Length > 0) secret.Length--;
                    continue;
                }
                if (!char.IsControl(key.KeyChar)) secret.Append(key.KeyChar);
            }
            Console.WriteLine();
            return secret.ToString();
        }

        private static string FindSsh()
        {
            var candidates = new List<string>
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "OpenSSH", "ssh.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Sysnative", "OpenSSH", "ssh.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Git", "usr", "bin", "ssh.exe"),
            };
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                if (dir.Trim().Length > 0) candidates.Add(Path.Combine(dir.Trim(), "ssh.exe"));
            }
            foreach (var candidate in candidates)
            {
                try
                {
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException)
                {
                    // Malformed PATH entry.
                }
            }
            return null;
        }

        private static string StartTunnel(string ssh, string key, Settings settings)
        {
            var arguments = "-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 " +
                "-o StrictHostKeyChecking=accept-new -i \"" + key + "\" " +
                "-L 127.0.0.1:" + settings.LocalPort + ":127.0.0.1:" + settings.RemotePort + " " + settings.Host;
            var info = new ProcessStartInfo(ssh, arguments)
            {
                UseShellExecute = false,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            var stderr = new StringBuilder();
            try
            {
                tunnel = Process.Start(info);
            }
            catch (Exception error)
            {
                return "Could not start ssh: " + error.Message;
            }
            // ssh runs in its own hidden console, so closing this window does
            // not reach it. A kill-on-close job ties its lifetime to ours.
            ChildProcessJob.Attach(tunnel);
            tunnel.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data);
            };
            tunnel.BeginErrorReadLine();

            var deadline = DateTime.UtcNow.AddSeconds(25);
            while (DateTime.UtcNow < deadline)
            {
                if (tunnel.HasExited)
                {
                    // HasExited can turn true before the async stderr reader
                    // delivered the last lines; this wait drains the stream.
                    tunnel.WaitForExit();
                    string said;
                    lock (stderr) said = stderr.ToString().Trim();
                    tunnel = null;
                    return "The tunnel did not come up. Most likely the bot host is unreachable or the key was rejected." +
                        (said.Length > 0 ? Environment.NewLine + "  ssh said: " + said : "");
                }
                if (PortOpen(settings.LocalPort)) return null;
                Thread.Sleep(250);
            }
            StopTunnel();
            return "The tunnel did not come up within 25s.";
        }

        private static void StopTunnel()
        {
            try
            {
                if (tunnel != null && !tunnel.HasExited) tunnel.Kill();
            }
            catch (InvalidOperationException)
            {
                // Already gone.
            }
        }

        private static bool PortOpen(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var attempt = client.BeginConnect("127.0.0.1", port, null, null);
                    if (!attempt.AsyncWaitHandle.WaitOne(300)) return false;
                    client.EndConnect(attempt);
                    return true;
                }
            }
            catch (SocketException)
            {
                return false;
            }
        }

        private static void OpenBrowser(string url)
        {
            Console.WriteLine("  Opening " + url);
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception error)
            {
                Console.WriteLine("  Could not open a browser: " + error.Message);
                Console.WriteLine("  Open this yourself: " + url);
            }
        }

        // The panel answers every unauthenticated request with a Basic
        // challenge; anything else on the port is some other program.
        private static bool LooksLikePanel(int port)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                request.Timeout = 3000;
                request.Proxy = null;
                using (request.GetResponse())
                {
                    return false;
                }
            }
            catch (WebException error)
            {
                var response = error.Response as HttpWebResponse;
                if (response == null) return false;
                using (response)
                {
                    var challenge = response.Headers["WWW-Authenticate"] ?? "";
                    return response.StatusCode == HttpStatusCode.Unauthorized &&
                        challenge.StartsWith("Basic", StringComparison.OrdinalIgnoreCase);
                }
            }
        }

        private static void ClearClipboardIfHolding(string password)
        {
            if (string.IsNullOrEmpty(password)) return;
            try
            {
                if (Clipboard.ContainsText() && Clipboard.GetText() == password) Clipboard.Clear();
            }
            catch (Exception)
            {
                // Clipboard busy or unavailable: nothing else to do.
            }
        }

        private static bool CopyToClipboard(string text)
        {
            try
            {
                Clipboard.SetText(text);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static int Fail(string message)
        {
            Console.WriteLine();
            Console.WriteLine("  " + message);
            Console.WriteLine();
            if (!Console.IsInputRedirected)
            {
                Console.WriteLine("  Press any key to exit.");
                Console.ReadKey(true);
            }
            return 1;
        }
    }
}
