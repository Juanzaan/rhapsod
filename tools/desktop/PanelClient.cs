using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

namespace RhapsodDashboard
{
    internal sealed class PanelState
    {
        public bool Reachable;
        public bool Unauthorized;
        // HTTP status of any other error answer (a 500 from the panel), or 0.
        public int ErrorStatus;
        // The headers came back but the body did not (see Tunnel relay mode).
        public bool BodyStalled;
        public bool Connected;
        public string PlayerState = "";
        public string Title = "";
    }

    // Talks to the panel through the tunnel. Credentials stay in memory and go
    // out only as the Authorization header of requests to 127.0.0.1.
    internal static class PanelClient
    {
        // The panel answers every unauthenticated request with a Basic
        // challenge; anything else on the port is some other program.
        public static bool LooksLikePanel(int port)
        {
            try
            {
                var request = Request(port, "/api/health", null, null);
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

        public static PanelState GetState(Settings settings, string password)
        {
            var state = new PanelState();
            if (string.IsNullOrEmpty(password)) return state;
            try
            {
                var request = Request(settings.LocalPort, "/api/state", settings.PanelUser, password);
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    string text;
                    try
                    {
                        using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                        {
                            text = reader.ReadToEnd();
                        }
                    }
                    catch (IOException)
                    {
                        state.BodyStalled = true;
                        return state;
                    }
                    catch (WebException)
                    {
                        state.BodyStalled = true;
                        return state;
                    }
                    var body = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text);
                    state.Reachable = true;
                    object value;
                    if (body.TryGetValue("connected", out value) && value is bool) state.Connected = (bool)value;
                    if (body.TryGetValue("playerState", out value) && value != null) state.PlayerState = value.ToString();
                    if (body.TryGetValue("currentTitle", out value) && value != null) state.Title = value.ToString();
                }
            }
            catch (WebException error)
            {
                var response = error.Response as HttpWebResponse;
                if (response != null)
                {
                    using (response)
                    {
                        state.Reachable = true;
                        state.Unauthorized = response.StatusCode == HttpStatusCode.Unauthorized;
                        if (!state.Unauthorized) state.ErrorStatus = (int)response.StatusCode;
                    }
                }
            }
            catch (ArgumentException)
            {
                // Not JSON: treat as unreachable.
            }
            catch (InvalidOperationException)
            {
                // Not JSON: treat as unreachable.
            }
            return state;
        }

        private static HttpWebRequest Request(int port, string path, string user, string password)
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
            // Relay mode adds an SSH login to every request.
            request.Timeout = 8000;
            request.ReadWriteTimeout = 3000;
            request.Proxy = null;
            request.KeepAlive = false;
            if (user != null)
            {
                var token = Convert.ToBase64String(Encoding.UTF8.GetBytes(user + ":" + password));
                request.Headers[HttpRequestHeader.Authorization] = "Basic " + token;
            }
            return request;
        }
    }
}
