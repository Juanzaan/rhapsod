using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace RhapsodDashboard
{
    internal enum LinkState
    {
        Connecting,
        // Our own ssh process forwards the port.
        Connected,
        // The port already answers like the panel (another window or a
        // tunnel opened by hand); we use it but do not own it.
        Shared,
        // Waiting to retry after a drop or a failed attempt.
        Retrying,
    }

    internal sealed class TrayApp : ApplicationContext
    {
        private static readonly int[] RetryDelaysSeconds = { 5, 10, 20, 40, 60 };
        private const int StatusPollSeconds = 5;
        private const int ClipboardSeconds = 30;

        // Work finished on thread-pool threads comes back through this hidden
        // control. SynchronizationContext.Current is not reliable here (it can
        // be a plain context that posts to the thread pool), and the
        // clipboard and the tray must only be touched on the UI thread.
        private readonly Control marshal = new Control();
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly ToolStripMenuItem statusItem = new ToolStripMenuItem { Enabled = false };
        private readonly System.Windows.Forms.Timer supervisor = new System.Windows.Forms.Timer { Interval = 1000 };
        private readonly Icon iconPlaying = MakeIcon(Color.FromArgb(91, 211, 138));
        private readonly Icon iconIdle = MakeIcon(Color.FromArgb(150, 160, 170));
        private readonly Icon iconBusy = MakeIcon(Color.FromArgb(214, 150, 30));
        private readonly Icon iconDown = MakeIcon(Color.FromArgb(235, 95, 85));

        private Settings settings;
        private string password;
        private Tunnel tunnel;
        private LinkState state = LinkState.Connecting;
        private bool connecting;
        private bool polling;
        private int failures;
        private DateTime nextAttemptAt = DateTime.MinValue;
        private DateTime nextPollAt = DateTime.MinValue;
        private DateTime clipboardClearAt = DateTime.MaxValue;
        private bool openWhenReady = true;
        private bool warnedUnauthorized;
        private string lastError = "";

        public TrayApp(Settings settings, string password)
        {
            // Reading Handle creates the window on this, the UI, thread.
            var created = marshal.Handle;
            GC.KeepAlive(created);
            this.settings = settings;
            this.password = password;
            tunnel = new Tunnel(settings);

            var menu = new ContextMenuStrip();
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            var open = new ToolStripMenuItem("Abrir panel", null, delegate { OpenPanel(); });
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(open);
            menu.Items.Add(new ToolStripMenuItem("Copiar contraseña", null, delegate { CopyPassword(); }));
            menu.Items.Add(new ToolStripMenuItem("Reconectar", null, delegate { Reconnect(); }));
            menu.Items.Add(new ToolStripMenuItem("Configuración…", null, delegate { EditSettings(); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Salir", null, delegate { Quit(); }));

            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenPanel(); };
            tray.Visible = true;
            ShowStatus("Conectando…", iconBusy);

            supervisor.Tick += delegate { Supervise(); };
            supervisor.Start();
            Connect();
        }

        // Called from another launch of the app (single instance).
        public void OpenPanelFromOtherInstance()
        {
            OnUi(delegate { OpenPanel(); });
        }

        private void OnUi(MethodInvoker action)
        {
            if (marshal.IsDisposed) return;
            try
            {
                marshal.BeginInvoke(action);
            }
            catch (InvalidOperationException)
            {
                // Shutting down: the window is gone.
            }
        }

        private void Connect()
        {
            if (connecting) return;
            connecting = true;
            state = LinkState.Connecting;
            ShowStatus("Conectando con " + settings.Host + "…", iconBusy);
            var target = settings;
            var ownTunnel = tunnel;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    ConnectInBackground(target, ownTunnel);
                }
                catch (Exception failure)
                {
                    // A background exception would end the process; report it
                    // as a failed attempt and let the retry loop continue.
                    Program.Log(failure);
                    OnUi(delegate { Connected(ownTunnel, LinkState.Retrying, "Error inesperado: " + failure.Message, false); });
                }
            });
        }

        private void ConnectInBackground(Settings target, Tunnel ownTunnel)
        {
            LinkState result;
            string error = null;
            if (PortProbe.IsOpen(target.LocalPort))
            {
                // Only reuse the port when it answers like the panel:
                // another program there must not get the password.
                if (PanelClient.LooksLikePanel(target.LocalPort))
                {
                    result = LinkState.Shared;
                }
                else
                {
                    result = LinkState.Retrying;
                    error = "El puerto " + target.LocalPort + " lo usa otro programa. Cerrarlo o elegir otro puerto en Configuración.";
                }
            }
            else
            {
                error = ownTunnel.Start();
                result = error == null ? LinkState.Connected : LinkState.Retrying;
                if (ownTunnel.HostKeyUnknown)
                {
                    string fetchError;
                    var keys = HostKeys.Fetch(target, out fetchError);
                    OnUi(delegate { AskHostKey(ownTunnel, target, keys, fetchError); });
                    return;
                }
            }
            // The tunnel being up does not mean the panel answers (the bot
            // may be restarting): opening the window then shows a blank
            // page with no login prompt.
            var panelReady = result == LinkState.Shared ||
                (result == LinkState.Connected && WaitForPanel(target.LocalPort));
            OnUi(delegate { Connected(ownTunnel, result, error, panelReady); });
        }

        private static bool WaitForPanel(int port)
        {
            var deadline = DateTime.UtcNow.AddSeconds(10);
            while (DateTime.UtcNow < deadline)
            {
                if (PanelClient.LooksLikePanel(port)) return true;
                Thread.Sleep(500);
            }
            return false;
        }

        private void Connected(Tunnel attempted, LinkState result, string error, bool panelReady)
        {
            connecting = false;
            if (attempted != tunnel)
            {
                // Settings changed while connecting; that tunnel is stale.
                attempted.Stop();
                Connect();
                return;
            }
            state = result;
            if (result == LinkState.Retrying)
            {
                ScheduleRetry(error);
                return;
            }
            failures = 0;
            lastError = "";
            nextPollAt = DateTime.UtcNow;
            if (!panelReady)
            {
                // Stay connected; the status poll opens the window once the
                // panel answers.
                ShowStatus("Túnel abierto; el panel no responde", iconBusy);
                return;
            }
            ShowStatus("Conectado", iconIdle);
            if (openWhenReady)
            {
                openWhenReady = false;
                OpenPanel();
            }
        }

        // Runs with connecting still set, so the supervisor does not start a
        // second attempt while the question is open.
        private void AskHostKey(Tunnel attempted, Settings target, List<string> keys, string fetchError)
        {
            if (attempted != tunnel)
            {
                connecting = false;
                attempted.Stop();
                Connect();
                return;
            }
            if (fetchError != null)
            {
                connecting = false;
                ScheduleRetry(fetchError);
                return;
            }
            var fingerprints = new StringBuilder();
            foreach (var line in keys) fingerprints.AppendLine(HostKeys.Fingerprint(line));
            var answer = MessageBox.Show(
                "Primera conexión con " + target.Host + ". Su huella es:" + Environment.NewLine + Environment.NewLine +
                fingerprints + Environment.NewLine +
                "Comparar con la salida de este comando en el servidor:" + Environment.NewLine +
                "for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf \"$f\"; done" + Environment.NewLine + Environment.NewLine +
                "¿Coincide?",
                "Rhapsod: confirmar el servidor", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            connecting = false;
            if (answer != DialogResult.Yes)
            {
                state = LinkState.Retrying;
                nextAttemptAt = DateTime.MaxValue;
                lastError = "";
                ShowStatus("Servidor sin confirmar; usar Reconectar", iconDown);
                return;
            }
            try
            {
                HostKeys.Trust(keys);
            }
            catch (Exception failure)
            {
                Program.Log(failure);
                ScheduleRetry("No se pudo guardar la huella del servidor: " + failure.Message);
                return;
            }
            Connect();
        }

        private void ScheduleRetry(string error)
        {
            var delay = RetryDelaysSeconds[Math.Min(failures, RetryDelaysSeconds.Length - 1)];
            failures++;
            nextAttemptAt = DateTime.UtcNow.AddSeconds(delay);
            state = LinkState.Retrying;
            ShowStatus("Sin conexión; reintento en " + delay + " s", iconDown);
            if (error != null && error != lastError)
            {
                lastError = error;
                tray.ShowBalloonTip(8000, "Rhapsod sin conexión", error, ToolTipIcon.Warning);
            }
        }

        private void Supervise()
        {
            var now = DateTime.UtcNow;
            if (now >= clipboardClearAt)
            {
                clipboardClearAt = DateTime.MaxValue;
                ClearClipboardIfHolding();
            }
            if (connecting) return;
            switch (state)
            {
                case LinkState.Connected:
                    if (!tunnel.IsRunning)
                    {
                        tray.ShowBalloonTip(5000, "Rhapsod", "Se cortó el túnel; reconectando.", ToolTipIcon.Warning);
                        ScheduleRetry(null);
                        nextAttemptAt = now;
                        return;
                    }
                    break;
                case LinkState.Shared:
                    if (!PortProbe.IsOpen(settings.LocalPort))
                    {
                        // Whoever owned the tunnel closed it: open our own.
                        Connect();
                        return;
                    }
                    break;
                case LinkState.Retrying:
                    if (now >= nextAttemptAt) Connect();
                    return;
                default:
                    return;
            }
            if (now >= nextPollAt && !polling)
            {
                nextPollAt = now.AddSeconds(StatusPollSeconds);
                Poll();
            }
        }

        private void Poll()
        {
            polling = true;
            var target = settings;
            var secret = password;
            ThreadPool.QueueUserWorkItem(delegate
            {
                PanelState result;
                try
                {
                    result = PanelClient.GetState(target, secret);
                }
                catch (Exception failure)
                {
                    Program.Log(failure);
                    result = new PanelState();
                }
                OnUi(delegate { ShowPanelState(result); });
            });
        }

        private void ShowPanelState(PanelState panel)
        {
            polling = false;
            if (state != LinkState.Connected && state != LinkState.Shared) return;
            if (!panel.Reachable)
            {
                ShowStatus("Túnel abierto; el panel no responde", iconBusy);
                return;
            }
            if (panel.ErrorStatus != 0)
            {
                ShowStatus("El panel respondió con error " + panel.ErrorStatus, iconDown);
                return;
            }
            if (panel.Unauthorized)
            {
                ShowStatus("Contraseña del panel incorrecta", iconDown);
                if (!warnedUnauthorized)
                {
                    warnedUnauthorized = true;
                    tray.ShowBalloonTip(8000, "Rhapsod", "El panel rechazó la contraseña guardada. Actualizarla en Configuración.", ToolTipIcon.Warning);
                }
                return;
            }
            warnedUnauthorized = false;
            if (openWhenReady)
            {
                openWhenReady = false;
                OpenPanel();
            }
            if (!panel.Connected)
            {
                ShowStatus("Bot sin conexión a TeamSpeak", iconBusy);
                return;
            }
            switch (panel.PlayerState)
            {
                case "playing":
                    ShowStatus(panel.Title.Length > 0 ? "Sonando: " + panel.Title : "Sonando", iconPlaying);
                    break;
                case "buffering":
                    ShowStatus("Cargando: " + panel.Title, iconPlaying);
                    break;
                case "paused":
                    ShowStatus("En pausa: " + panel.Title, iconIdle);
                    break;
                default:
                    ShowStatus("Sin reproducir", iconIdle);
                    break;
            }
        }

        private void ShowStatus(string text, Icon icon)
        {
            statusItem.Text = MenuText(text);
            tray.Icon = icon;
            // NotifyIcon.Text throws above 63 characters.
            var tip = "Rhapsod: " + text;
            tray.Text = tip.Length > 63 ? tip.Substring(0, 62) + "…" : tip;
        }

        private void OpenPanel()
        {
            if (state != LinkState.Connected && state != LinkState.Shared)
            {
                // Open as soon as the tunnel is back.
                openWhenReady = true;
                if (state == LinkState.Retrying) Reconnect();
                return;
            }
            try
            {
                PanelWindow.Open(settings.PanelUrl);
            }
            catch (Exception error)
            {
                MessageBox.Show("No se pudo abrir el panel: " + error.Message + Environment.NewLine + settings.PanelUrl,
                    "Rhapsod", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            CopyPassword();
        }

        private void CopyPassword()
        {
            if (string.IsNullOrEmpty(password)) return;
            try
            {
                Clipboard.SetDataObject(SecretClipboardData(password), true);
                clipboardClearAt = DateTime.UtcNow.AddSeconds(ClipboardSeconds);
                tray.ShowBalloonTip(4000, "Rhapsod", "Usuario " + settings.PanelUser + ". Contraseña copiada; se borra en " + ClipboardSeconds + " s.", ToolTipIcon.Info);
            }
            catch (ExternalException)
            {
                // Clipboard busy: the password stays in Credential Manager.
            }
        }

        // Menu items read "&" as a mnemonic prefix: "Simon & Garfunkel"
        // would show as "Simon  Garfunkel" with an underlined G.
        internal static string MenuText(string text)
        {
            return text.Replace("&", "&&");
        }

        // Clearing the clipboard later does not reach Win+V history or cloud
        // sync, which keep their own copy. These formats ask Windows (and
        // clipboard managers) to skip the password in the first place.
        internal static DataObject SecretClipboardData(string secret)
        {
            var data = new DataObject();
            data.SetData(DataFormats.UnicodeText, secret);
            data.SetData("ExcludeClipboardContentFromMonitorProcessing", new MemoryStream(BitConverter.GetBytes(0)));
            data.SetData("CanIncludeInClipboardHistory", new MemoryStream(BitConverter.GetBytes(0)));
            data.SetData("CanUploadToCloudClipboard", new MemoryStream(BitConverter.GetBytes(0)));
            return data;
        }

        private void ClearClipboardIfHolding()
        {
            if (string.IsNullOrEmpty(password)) return;
            try
            {
                if (Clipboard.ContainsText() && Clipboard.GetText() == password) Clipboard.Clear();
            }
            catch (ExternalException)
            {
                // Clipboard busy: nothing else to do.
            }
        }

        private void Reconnect()
        {
            if (connecting) return;
            tunnel.Stop();
            failures = 0;
            Connect();
        }

        private void EditSettings()
        {
            var hasSaved = CredentialStore.Read(settings.CredentialTarget) != null;
            using (var form = new SettingsForm(settings, hasSaved))
            {
                if (form.ShowDialog() != DialogResult.OK) return;
                var changed = form.Result;
                var newPassword = form.NewPassword ?? (changed.Host == settings.Host ? password : null);
                if (newPassword == null)
                {
                    MessageBox.Show("Al cambiar de servidor hay que escribir la contraseña del panel.", "Rhapsod",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                Program.SaveSettings(changed, newPassword, settings);
                tunnel.Stop();
                settings = changed;
                password = newPassword;
                tunnel = new Tunnel(settings);
                failures = 0;
                warnedUnauthorized = false;
                openWhenReady = false;
                Connect();
            }
        }

        private void Quit()
        {
            supervisor.Stop();
            ClearClipboardIfHolding();
            tunnel.Stop();
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }

        [DllImport("user32.dll")]
        private static extern bool DestroyIcon(IntPtr handle);

        // The "r." mark from the panel favicon (src/panel/dashboard-design.ts),
        // drawn at 32 px. The dot carries the state color, so the shape stays
        // the same and only the dot changes.
        private static Icon MakeIcon(Color color)
        {
            using (var bitmap = new Bitmap(32, 32))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.Clear(Color.Transparent);
                using (var tile = new GraphicsPath())
                using (var background = new SolidBrush(Color.FromArgb(13, 20, 17)))
                {
                    tile.AddArc(0, 0, 14, 14, 180, 90);
                    tile.AddArc(17, 0, 14, 14, 270, 90);
                    tile.AddArc(17, 17, 14, 14, 0, 90);
                    tile.AddArc(0, 17, 14, 14, 90, 90);
                    tile.CloseFigure();
                    graphics.FillPath(background, tile);
                }
                using (var letter = new GraphicsPath())
                using (var pen = new Pen(Color.FromArgb(238, 242, 236), 4.5f))
                {
                    letter.AddLine(10.5f, 25f, 10.5f, 15f);
                    letter.AddArc(10.5f, 8f, 14f, 14f, 180, 90);
                    letter.AddLine(17.5f, 8f, 20.5f, 8f);
                    graphics.DrawPath(pen, letter);
                }
                using (var fill = new SolidBrush(color))
                {
                    graphics.FillEllipse(fill, 18.5f, 18.5f, 8f, 8f);
                }
                var handle = bitmap.GetHicon();
                try
                {
                    return (Icon)Icon.FromHandle(handle).Clone();
                }
                finally
                {
                    DestroyIcon(handle);
                }
            }
        }
    }
}
