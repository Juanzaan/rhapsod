using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace RhapsodDashboard
{
    // Connection settings and panel password. The password field starts empty
    // when one is already saved; leaving it empty keeps the saved one.
    internal sealed class SettingsForm : Form
    {
        private readonly TextBox host = new TextBox();
        private readonly TextBox key = new TextBox();
        private readonly TextBox user = new TextBox();
        private readonly TextBox password = new TextBox();
        private readonly NumericUpDown localPort = new NumericUpDown();
        private readonly NumericUpDown remotePort = new NumericUpDown();
        private readonly bool hasSavedPassword;

        public Settings Result { get; private set; }
        public string NewPassword { get; private set; }

        public SettingsForm(Settings current, bool hasSavedPassword)
        {
            this.hasSavedPassword = hasSavedPassword;
            Text = "Rhapsod: configuración";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Padding = new Padding(12);
            Font = SystemFonts.MessageBoxFont;

            var layout = new TableLayoutPanel
            {
                ColumnCount = 3,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Dock = DockStyle.Fill,
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 300));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            host.Text = current.Host;
            key.Text = current.KeyPath.Length > 0
                ? current.KeyPath
                : Path.Combine("%USERPROFILE%", ".ssh", "id_ed25519");
            user.Text = current.PanelUser;
            password.UseSystemPasswordChar = true;
            ConfigurePort(localPort, current.LocalPort);
            ConfigurePort(remotePort, current.RemotePort);

            var browse = new Button { Text = "Buscar…", AutoSize = true };
            browse.Click += delegate { BrowseKey(); };

            AddRow(layout, "Destino SSH (usuario@servidor)", host, null);
            AddRow(layout, "Clave privada SSH", key, browse);
            AddRow(layout, "Usuario del panel", user, null);
            AddRow(layout, hasSavedPassword ? "Contraseña (vacío = sin cambios)" : "Contraseña del panel", password, null);
            AddRow(layout, "Puerto local", localPort, null);
            AddRow(layout, "Puerto del panel en el servidor", remotePort, null);

            var buttons = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.RightToLeft,
                AutoSize = true,
                Dock = DockStyle.Fill,
                Margin = new Padding(0, 12, 0, 0),
            };
            var save = new Button { Text = "Guardar", AutoSize = true, DialogResult = DialogResult.None };
            var cancel = new Button { Text = "Cancelar", AutoSize = true, DialogResult = DialogResult.Cancel };
            save.Click += delegate { Accept(); };
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(save);
            layout.Controls.Add(buttons, 0, layout.RowCount);
            layout.SetColumnSpan(buttons, 3);
            AcceptButton = save;
            CancelButton = cancel;
            Controls.Add(layout);
        }

        private static void ConfigurePort(NumericUpDown field, int value)
        {
            field.Minimum = 1;
            field.Maximum = 65535;
            field.Value = value;
            field.Width = 90;
        }

        private static void AddRow(TableLayoutPanel layout, string label, Control field, Control extra)
        {
            var row = layout.RowCount;
            layout.RowCount = row + 1;
            layout.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 8, 6) }, 0, row);
            field.Dock = field is NumericUpDown ? DockStyle.None : DockStyle.Fill;
            layout.Controls.Add(field, 1, row);
            if (extra != null) layout.Controls.Add(extra, 2, row);
        }

        private void BrowseKey()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "Elegir la clave privada SSH";
                dialog.InitialDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh");
                dialog.Filter = "Todos los archivos|*.*";
                if (dialog.ShowDialog(this) == DialogResult.OK) key.Text = dialog.FileName;
            }
        }

        private void Accept()
        {
            var hostText = host.Text.Trim();
            var keyText = key.Text.Trim();
            if (hostText.Length == 0)
            {
                Warn("Falta el destino SSH, por ejemplo rhapsod@203.0.113.10.");
                return;
            }
            if (hostText.StartsWith("-"))
            {
                // ssh would read it as an option.
                Warn("El destino SSH no puede empezar con un guion.");
                return;
            }
            if (!File.Exists(Environment.ExpandEnvironmentVariables(keyText)))
            {
                Warn("No existe la clave SSH en " + Environment.ExpandEnvironmentVariables(keyText) + ".");
                return;
            }
            if (!hasSavedPassword && password.Text.Length == 0)
            {
                Warn("Falta la contraseña del panel.");
                return;
            }
            Result = new Settings
            {
                Host = hostText,
                KeyPath = keyText,
                PanelUser = user.Text.Trim().Length > 0 ? user.Text.Trim() : "admin",
                LocalPort = (int)localPort.Value,
                RemotePort = (int)remotePort.Value,
            };
            NewPassword = password.Text.Length > 0 ? password.Text : null;
            DialogResult = DialogResult.OK;
            Close();
        }

        private void Warn(string message)
        {
            MessageBox.Show(this, message, "Rhapsod", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
