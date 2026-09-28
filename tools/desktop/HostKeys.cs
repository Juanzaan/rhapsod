using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace RhapsodDashboard
{
    // First-contact host key check. ssh runs with StrictHostKeyChecking=yes,
    // so an unknown server fails instead of being trusted silently (what
    // accept-new did). The app then fetches the server's key without logging
    // in, shows its fingerprint and, once the user confirms it, stores it in
    // its own known_hosts next to dashboard.conf. Keys already in
    // ~/.ssh/known_hosts keep working.
    internal static class HostKeys
    {
        public static string AppKnownHostsPath
        {
            get { return Path.Combine(Path.GetDirectoryName(Settings.DefaultFilePath), "known_hosts"); }
        }

        public static string KnownHostsOption()
        {
            return KnownHostsOption(AppKnownHostsPath) + " ~/.ssh/known_hosts\"";
        }

        // ssh splits UserKnownHostsFile on spaces and reads backslashes as
        // escapes, so the path goes quoted and with forward slashes, which
        // both the Windows OpenSSH and the Git for Windows ssh accept. The
        // outer quotes are left open for the caller to add more files.
        private static string KnownHostsOption(string path)
        {
            return "-o \"UserKnownHostsFile=\\\"" + path.Replace('\\', '/') + "\\\"";
        }

        public static bool IsUnknownHostError(string sshError)
        {
            // "No ED25519 host key is known for x and you have requested
            // strict checking." A changed key prints a different warning and
            // must stay an error.
            return sshError.IndexOf("host key is known for", StringComparison.OrdinalIgnoreCase) >= 0 &&
                sshError.IndexOf("IDENTIFICATION HAS CHANGED", StringComparison.OrdinalIgnoreCase) < 0;
        }

        // Connects with a throwaway known_hosts and no authentication method,
        // so ssh records the server's key and gives up before logging in.
        // Resolves ssh config aliases, ports and jump hosts like the tunnel.
        public static List<string> Fetch(Settings settings, out string error)
        {
            error = null;
            var lines = new List<string>();
            var ssh = Tunnel.FindSsh();
            if (ssh == null)
            {
                error = "No se encontró ssh.exe.";
                return lines;
            }
            var scratch = Path.GetTempFileName();
            try
            {
                var arguments = "-N -o BatchMode=yes -o PreferredAuthentications=none -o ConnectTimeout=15 " +
                    "-o StrictHostKeyChecking=accept-new " + KnownHostsOption(scratch) + "\" " + settings.Host;
                using (var process = Process.Start(new ProcessStartInfo(ssh, arguments)
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                }))
                {
                    if (!process.WaitForExit(20000))
                    {
                        try
                        {
                            process.Kill();
                        }
                        catch (InvalidOperationException)
                        {
                            // Already gone.
                        }
                    }
                }
                foreach (var line in File.ReadAllLines(scratch))
                {
                    if (Fingerprint(line) != null) lines.Add(line);
                }
                if (lines.Count == 0) error = "No se pudo leer la clave del servidor " + settings.Host + ".";
            }
            catch (Exception failure)
            {
                error = "No se pudo leer la clave del servidor: " + failure.Message;
            }
            finally
            {
                try
                {
                    File.Delete(scratch);
                }
                catch (IOException)
                {
                    // Temp folder cleanup catches it later.
                }
            }
            return lines;
        }

        // "SHA256:..." as ssh-keygen -l prints it, or null for a line that is
        // not a host key.
        public static string Fingerprint(string knownHostsLine)
        {
            var fields = knownHostsLine.Trim().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length < 3 || fields[0].StartsWith("#") || fields[0].StartsWith("@")) return null;
            byte[] blob;
            try
            {
                blob = Convert.FromBase64String(fields[2]);
            }
            catch (FormatException)
            {
                return null;
            }
            using (var sha = SHA256.Create())
            {
                return fields[1] + " SHA256:" + Convert.ToBase64String(sha.ComputeHash(blob)).TrimEnd('=');
            }
        }

        public static void Trust(List<string> lines)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(AppKnownHostsPath));
            File.AppendAllText(AppKnownHostsPath, string.Join("\n", lines.ToArray()) + "\n", new UTF8Encoding(false));
        }
    }
}
