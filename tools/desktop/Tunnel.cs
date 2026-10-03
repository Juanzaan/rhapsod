using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace RhapsodDashboard
{
    // One ssh -N -L process forwarding 127.0.0.1:LocalPort to the panel on the
    // bot host. Start blocks until the port answers or ssh gives up, so call
    // it off the UI thread.
    //
    // Relay mode replaces -L with an in-process listener that runs one
    // ssh -W per connection. On one owner PC, Git for Windows' ssh (10.3p1)
    // passed only the first write of each answer through -L (the headers,
    // never the body) while -W carried the whole answer; it did not
    // reproduce against a local sshd in CI. Relay mode costs an SSH login
    // per request, so it is only used once a stalled answer shows up.
    internal sealed class Tunnel
    {
        private readonly Settings settings;
        private Process process;
        private Relay relay;

        public Tunnel(Settings settings)
        {
            this.settings = settings;
        }

        // Set by Start when ssh refused a server whose host key is not in
        // any known_hosts file yet; the caller asks the user about it.
        public bool HostKeyUnknown { get; private set; }

        public bool UseRelay { get; set; }

        public string SshPath { get; private set; }

        public bool IsRunning
        {
            get
            {
                if (relay != null) return true;
                var current = process;
                return current != null && !current.HasExited;
            }
        }

        // Returns null on success, otherwise the reason ssh did not come up.
        public string Start()
        {
            var ssh = FindSsh();
            SshPath = ssh;
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
            var common = "-o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 " +
                "-o StrictHostKeyChecking=yes " + HostKeys.KnownHostsOption() + " -i \"" + key + "\" ";
            if (UseRelay)
            {
                try
                {
                    relay = new Relay(settings.LocalPort, ssh, common + "-W 127.0.0.1:" + settings.RemotePort + " " + settings.Host);
                    return null;
                }
                catch (SocketException error)
                {
                    return "No se pudo abrir el puerto " + settings.LocalPort + ": " + error.Message;
                }
            }
            var arguments = "-N -o ExitOnForwardFailure=yes " + common +
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
            var currentRelay = relay;
            relay = null;
            if (currentRelay != null) currentRelay.Stop();
            var current = process;
            process = null;
            try
            {
                if (current != null && !current.HasExited)
                {
                    current.Kill();
                    // The port must be free before a relay listens on it.
                    current.WaitForExit(3000);
                }
            }
            catch (InvalidOperationException)
            {
                // Already gone.
            }
        }

        internal static bool IsWindowsSsh(string path)
        {
            var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            return path != null && path.StartsWith(windows + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
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

    // Listens on 127.0.0.1:port and pipes each connection through its own
    // process (ssh -W), stdin and stdout carrying the bytes.
    internal sealed class Relay
    {
        private readonly TcpListener listener;
        private readonly string fileName;
        private readonly string arguments;
        private readonly List<Process> running = new List<Process>();
        private volatile bool stopped;

        public Relay(int port, string fileName, string arguments)
        {
            this.fileName = fileName;
            this.arguments = arguments;
            listener = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
            listener.Start();
            new Thread(Accept) { IsBackground = true, Name = "relay" }.Start();
        }

        public void Stop()
        {
            stopped = true;
            listener.Stop();
            lock (running)
            {
                foreach (var each in running) Kill(each);
                running.Clear();
            }
        }

        private void Accept()
        {
            while (!stopped)
            {
                TcpClient client;
                try
                {
                    client = listener.AcceptTcpClient();
                }
                catch (SocketException)
                {
                    return;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                client.NoDelay = true;
                ThreadPool.QueueUserWorkItem(delegate { Serve(client); });
            }
        }

        private void Serve(TcpClient client)
        {
            Process child = null;
            try
            {
                child = Process.Start(new ProcessStartInfo(fileName, arguments)
                {
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                });
                ChildProcessJob.Attach(child);
                child.ErrorDataReceived += delegate { };
                child.BeginErrorReadLine();
                lock (running)
                {
                    if (stopped) return;
                    running.Add(child);
                }
                var network = client.GetStream();
                var input = child.StandardInput.BaseStream;
                new Thread(delegate() { Pump(network, input, true); }) { IsBackground = true }.Start();
                Pump(child.StandardOutput.BaseStream, network, false);
            }
            catch (Exception error)
            {
                if (!stopped) Program.Log(error);
            }
            finally
            {
                client.Close();
                if (child != null)
                {
                    lock (running) running.Remove(child);
                    Kill(child);
                }
            }
        }

        // Closing the target after the client stops sending lets ssh pass the
        // end of the request on to the panel.
        private static void Pump(Stream from, Stream to, bool closeTarget)
        {
            var buffer = new byte[16384];
            try
            {
                int read;
                while ((read = from.Read(buffer, 0, buffer.Length)) > 0)
                {
                    to.Write(buffer, 0, read);
                    to.Flush();
                }
            }
            catch (IOException)
            {
                // One side went away.
            }
            catch (ObjectDisposedException)
            {
                // One side went away.
            }
            finally
            {
                if (closeTarget)
                {
                    try
                    {
                        to.Close();
                    }
                    catch (IOException)
                    {
                        // Already closed.
                    }
                }
            }
        }

        private static void Kill(Process child)
        {
            try
            {
                if (!child.HasExited) child.Kill();
            }
            catch (InvalidOperationException)
            {
                // Already gone.
            }
            catch (System.ComponentModel.Win32Exception)
            {
                // Exiting.
            }
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
