using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace RhapsodDashboard
{
    // One ssh -N -L process forwarding 127.0.0.1:LocalPort to the panel on the
    // bot host. Start blocks until the port answers or ssh gives up, so call
    // it off the UI thread.
    internal sealed class Tunnel
    {
        private readonly Settings settings;
        private Process process;

        public Tunnel(Settings settings)
        {
            this.settings = settings;
        }

        // Set by Start when ssh refused a server whose host key is not in
        // any known_hosts file yet; the caller asks the user about it.
        public bool HostKeyUnknown { get; private set; }

        public bool IsRunning
        {
            get
            {
                var current = process;
                return current != null && !current.HasExited;
            }
        }

        // Returns null on success, otherwise the reason ssh did not come up.
        public string Start()
        {
            var ssh = FindSsh();
            if (ssh == null)
            {
                return "No se encontró ssh.exe. Instalar el cliente OpenSSH de Windows o Git para Windows.";
            }
            var key = settings.ExpandedKeyPath;
            if (!File.Exists(key))
            {
                return "No se encontró la clave SSH en " + key + ".";
            }
            HostKeyUnknown = false;
            var arguments = "-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 " +
                "-o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes " + HostKeys.KnownHostsOption() +
                " -i \"" + key + "\" " +
                "-L 127.0.0.1:" + settings.LocalPort + ":127.0.0.1:" + settings.RemotePort + " " + settings.Host;
            var info = new ProcessStartInfo(ssh, arguments)
            {
                UseShellExecute = false,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            var stderr = new StringBuilder();
            Process started;
            try
            {
                started = Process.Start(info);
            }
            catch (Exception error)
            {
                return "No se pudo iniciar ssh: " + error.Message;
            }
            // ssh runs in its own hidden console; the job ties it to this app.
            ChildProcessJob.Attach(started);
            started.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data);
            };
            started.BeginErrorReadLine();
            process = started;

            var deadline = DateTime.UtcNow.AddSeconds(25);
            while (DateTime.UtcNow < deadline)
            {
                if (started.HasExited)
                {
                    // HasExited can turn true before the async stderr reader
                    // delivered the last lines; this wait drains the stream.
                    started.WaitForExit();
                    string said;
                    lock (stderr) said = stderr.ToString().Trim();
                    process = null;
                    if (HostKeys.IsUnknownHostError(said))
                    {
                        HostKeyUnknown = true;
                        return "El servidor todavía no es de confianza en esta PC.";
                    }
                    return "El túnel no se abrió: el servidor no responde o rechazó la clave." +
                        (said.Length > 0 ? " ssh: " + said : "");
                }
                if (PortProbe.IsOpen(settings.LocalPort)) return null;
                Thread.Sleep(250);
            }
            Stop();
            return "El túnel no se abrió en 25 segundos.";
        }

        public void Stop()
        {
            var current = process;
            process = null;
            try
            {
                if (current != null && !current.HasExited) current.Kill();
            }
            catch (InvalidOperationException)
            {
                // Already gone.
            }
        }

        internal static string FindSsh()
        {
            var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            var candidates = new List<string>
            {
                Path.Combine(windows, "System32", "OpenSSH", "ssh.exe"),
                Path.Combine(windows, "Sysnative", "OpenSSH", "ssh.exe"),
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
    }

    internal static class PortProbe
    {
        public static bool IsOpen(int port)
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
    }
}
