using System;
using System.Collections.Generic;
using System.IO;

namespace RhapsodDashboard
{
    // Connection settings, stored as key=value lines in
    // %APPDATA%\Rhapsod\dashboard.conf. Secrets never go here.
    internal sealed class Settings
    {
        public string Host = "";
        public string KeyPath = "";
        public int LocalPort = 8080;
        public int RemotePort = 8080;
        public string PanelUser = "admin";

        public static string DefaultFilePath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Rhapsod",
                    "dashboard.conf");
            }
        }

        public string CredentialTarget
        {
            get { return "Rhapsod Dashboard/" + Host; }
        }

        public string PanelUrl
        {
            get { return "http://127.0.0.1:" + LocalPort + "/"; }
        }

        public string ExpandedKeyPath
        {
            get { return Environment.ExpandEnvironmentVariables(KeyPath); }
        }

        public bool IsComplete
        {
            get { return Host.Length > 0 && KeyPath.Length > 0; }
        }

        public static Settings Load(string path)
        {
            if (!File.Exists(path)) return null;
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in File.ReadAllLines(path))
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
            if (values.TryGetValue("panel_user", out value) && value.Length > 0) settings.PanelUser = value;
            int port;
            if (values.TryGetValue("local_port", out value) && TryPort(value, out port)) settings.LocalPort = port;
            if (values.TryGetValue("remote_port", out value) && TryPort(value, out port)) settings.RemotePort = port;
            return settings;
        }

        public void Save(string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllLines(path, new[]
            {
                "# Rhapsod Dashboard settings. Edit here or use Configuracion in the tray menu.",
                "host=" + Host,
                "key=" + KeyPath,
                "local_port=" + LocalPort,
                "remote_port=" + RemotePort,
                "panel_user=" + PanelUser,
            });
        }

        public static bool TryPort(string text, out int port)
        {
            return int.TryParse(text, out port) && port > 0 && port < 65536;
        }
    }
}
