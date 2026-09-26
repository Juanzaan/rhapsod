using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
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

        private readonly SynchronizationContext ui;
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly ToolStripMenuItem statusItem = new ToolStripMenuItem { Enabled = false };
        private readonly System.Windows.Forms.Timer supervisor = new System.Windows.Forms.Timer { Interval = 1000 };
        private readonly Icon iconPlaying = MakeIcon(Color.FromArgb(34, 160, 90));
        private readonly Icon iconIdle = MakeIcon(Color.FromArgb(90, 100, 115));
        private readonly Icon iconBusy = MakeIcon(Color.FromArgb(214, 150, 30));
        private readonly Icon iconDown = MakeIcon(Color.FromArgb(200, 60, 60));

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
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
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
            ui.Post(delegate { OpenPanel(); }, null);
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
                }
                ui.Post(delegate { Connected(ownTunnel, result, error); }, null);
            });
        }

        private void Connected(Tunnel attempted, LinkState result, string error)
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
            ShowStatus("Conectado", iconIdle);
            if (openWhenReady)
            {
                openWhenReady = false;
                OpenPanel();
            }
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
                var result = PanelClient.GetState(target, secret);
                ui.Post(delegate { ShowPanelState(result); }, null);
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
            statusItem.Text = text;
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
                Clipboard.SetText(password);
                clipboardClearAt = DateTime.UtcNow.AddSeconds(ClipboardSeconds);
                tray.ShowBalloonTip(4000, "Rhapsod", "Usuario " + settings.PanelUser + ". Contraseña copiada; se borra en " + ClipboardSeconds + " s.", ToolTipIcon.Info);
            }
            catch (ExternalException)
            {
                // Clipboard busy: the password stays in Credential Manager.
            }
        }

        private void ClearClipboardIfHolding()
        {
            if (string.IsNullOrEmpty(password)) return;
            try
            {
                // Clipboard history and cloud sync keep whatever sits there.
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

        private static Icon MakeIcon(Color color)
        {
            using (var bitmap = new Bitmap(32, 32))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                graphics.Clear(Color.Transparent);
                using (var fill = new SolidBrush(color))
                {
                    graphics.FillEllipse(fill, 1, 1, 30, 30);
                }
                using (var font = new Font("Segoe UI", 18, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    graphics.DrawString("R", font, Brushes.White, new RectangleF(0, 1, 32, 32), format);
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
