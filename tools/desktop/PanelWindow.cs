using System;
using System.Diagnostics;
using System.IO;

namespace RhapsodDashboard
{
    // Opens the panel in its own window: a Chromium browser in app mode (no
    // tabs or address bar) with a separate profile, so the panel login never
    // mixes with the user's everyday browser. Falls back to the default
    // browser when no Chromium browser is installed.
    internal static class PanelWindow
    {
        public static void Open(string url)
        {
            var browser = FindChromium();
            if (browser != null)
            {
                var profile = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Rhapsod",
                    "panel-window");
                Directory.CreateDirectory(profile);
                var arguments = "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" " +
                    "--no-first-run --no-default-browser-check --window-size=1280,860";
                try
                {
                    Process.Start(new ProcessStartInfo(browser, arguments) { UseShellExecute = false });
                    return;
                }
                catch (Exception)
                {
                    // Fall through to the default browser.
                }
            }
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }

        private static string FindChromium()
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var candidates = new[]
            {
                Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
                Path.Combine(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            };
            foreach (var candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }
    }
}
