// MouseCapturer.cs
// Captura raw input del mouse (dx/dy + clicks) a nivel Windows, AUNQUE Valorant tenga el foco,
// y lo sirve como JSON sobre WebSocket en ws://127.0.0.1:9595/.
// La app Overwolf (Chromium) se conecta con new WebSocket('ws://127.0.0.1:9595/').
//
// Por que WebSocket y no TCP crudo: el JS de un window Overwolf corre en browser y NO puede
// abrir sockets TCP. WebSocket si. HttpListener de .NET hace el handshake WS nativo, sin libs.
//
// No inyecta nada en Valorant. Es input del SO + un server local. Limpio.

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        var server = new WsServer("http://127.0.0.1:9595/");
        server.Start();

        var window = new RawInputWindow(server);

        Application.Run(); // ventana + message loop (necesario para WM_INPUT)
    }
}

internal sealed class RawInputWindow : NativeWindow
{
    private const int WM_INPUT = 0x00FF;
    private const int RID_INPUT = 0x10000003;
    private const int RIM_TYPEMOUSE = 0;
    private const int RIM_TYPEKEYBOARD = 1;
    private const uint RIDEV_INPUTSINK = 0x00000100;

    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private readonly WsServer _server;
    private readonly System.Collections.Generic.HashSet<ushort> _pressed = new(); // teclas ya presionadas (ignora auto-repeat)

    public RawInputWindow(WsServer server)
    {
        _server = server;
        CreateHandle(new CreateParams { Parent = new IntPtr(-3) }); // HWND_MESSAGE
        var rid = new[]
        {
            new RAWINPUTDEVICE { usUsagePage = 0x01, usUsage = 0x02, dwFlags = RIDEV_INPUTSINK, hwndTarget = Handle }, // mouse
            new RAWINPUTDEVICE { usUsagePage = 0x01, usUsage = 0x06, dwFlags = RIDEV_INPUTSINK, hwndTarget = Handle }, // teclado
        };
        if (!RegisterRawInputDevices(rid, (uint)rid.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>()))
            throw new InvalidOperationException("RegisterRawInputDevices: " + Marshal.GetLastWin32Error());
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT) Handle_(m.LParam);
        base.WndProc(ref m);
    }

    private void Handle_(IntPtr h)
    {
        uint size = 0;
        GetRawInputData(h, RID_INPUT, IntPtr.Zero, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>());
        if (size == 0) return;
        IntPtr buf = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(h, RID_INPUT, buf, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>()) != size) return;
            var header = Marshal.PtrToStructure<RAWINPUTHEADER>(buf);
            long t = Clock.ElapsedTicks * 1000L / Stopwatch.Frequency;

            if (header.dwType == RIM_TYPEMOUSE)
            {
                var raw = Marshal.PtrToStructure<RAWINPUT>(buf);
                int dx = raw.mouse.lLastX, dy = raw.mouse.lLastY;
                ushort flags = raw.mouse.usButtonFlags;

                string action = "move", button = "none";
                if ((flags & 0x0001) != 0) { action = "down"; button = "left"; }
                else if ((flags & 0x0002) != 0) { action = "up"; button = "left"; }
                else if ((flags & 0x0004) != 0) { action = "down"; button = "right"; }
                else if ((flags & 0x0008) != 0) { action = "up"; button = "right"; }

                if (dx == 0 && dy == 0 && action == "move") return;
                _server.Enqueue(
                    "{\"t\":" + t + ",\"dx\":" + dx + ",\"dy\":" + dy +
                    ",\"a\":\"" + action + "\",\"b\":\"" + button + "\"}");
            }
            else if (header.dwType == RIM_TYPEKEYBOARD)
            {
                var raw = Marshal.PtrToStructure<RAWINPUT_KB>(buf);
                HandleKey(raw.keyboard, t);
            }
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    // Solo las teclas que nos importan: movimiento (WASD) + habilidades (Q E C X F) + shift/ctrl/space.
    private static string MapKey(ushort vk) => vk switch
    {
        0x57 => "w", 0x41 => "a", 0x53 => "s", 0x44 => "d",
        0x51 => "q", 0x45 => "e", 0x43 => "c", 0x58 => "x", 0x46 => "f",
        0x10 or 0xA0 or 0xA1 => "shift",
        0x11 or 0xA2 or 0xA3 => "ctrl",
        0x20 => "space",
        _ => null,
    };

    private void HandleKey(RAWKEYBOARD k, long t)
    {
        string key = MapKey(k.VKey);
        if (key == null) return;
        bool up = (k.Flags & 0x01) != 0; // RI_KEY_BREAK
        if (up) { if (!_pressed.Remove(k.VKey)) return; }
        else { if (!_pressed.Add(k.VKey)) return; } // ya estaba (auto-repeat) -> ignorar
        _server.Enqueue(
            "{\"t\":" + t + ",\"type\":\"key\",\"a\":\"" + (up ? "up" : "down") + "\",\"k\":\"" + key + "\"}");
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] d, uint n, uint cb);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(IntPtr h, uint cmd, IntPtr data, ref uint sz, uint cbHeader);

    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTDEVICE { public ushort usUsagePage, usUsage; public uint dwFlags; public IntPtr hwndTarget; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTHEADER { public int dwType, dwSize; public IntPtr hDevice, wParam; }
    [StructLayout(LayoutKind.Explicit)] private struct RAWMOUSE { 
        [FieldOffset(0)] public ushort usFlags;
        [FieldOffset(4)] public uint ulButtons;
        [FieldOffset(4)] public ushort usButtonFlags;
        [FieldOffset(6)] public ushort usButtonData;
        [FieldOffset(8)] public uint ulRawButtons;
        [FieldOffset(12)] public int lLastX;
        [FieldOffset(16)] public int lLastY;
        [FieldOffset(20)] public uint ulExtraInformation;
    }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUT { public RAWINPUTHEADER header; public RAWMOUSE mouse; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWKEYBOARD { public ushort MakeCode, Flags, Reserved, VKey; public uint Message, ExtraInformation; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUT_KB { public RAWINPUTHEADER header; public RAWKEYBOARD keyboard; }
}

// ---- Servidor WebSocket (HttpListener nativo). Un cliente (Overwolf) a la vez. ----
internal sealed class WsServer
{
    private readonly HttpListener _http = new();
    private readonly BlockingCollection<string> _q = new(boundedCapacity: 4096);
    private WebSocket? _ws;

    public WsServer(string prefix) { _http.Prefixes.Add(prefix); }

    public void Start()
    {
        _http.Start();
        Task.Run(AcceptLoop);
        Task.Run(SendLoop);
    }

    private async Task AcceptLoop()
    {
        while (true)
        {
            var ctx = await _http.GetContextAsync();
            if (!ctx.Request.IsWebSocketRequest) { ctx.Response.StatusCode = 400; ctx.Response.Close(); continue; }
            var wsCtx = await ctx.AcceptWebSocketAsync(null);
            _ws = wsCtx.WebSocket; // si reconecta, reemplazamos
        }
    }

    private async Task SendLoop()
    {
        foreach (var line in _q.GetConsumingEnumerable())
        {
            var ws = _ws;
            if (ws is not { State: WebSocketState.Open }) continue;
            try { await ws.SendAsync(Encoding.ASCII.GetBytes(line), WebSocketMessageType.Text, true, CancellationToken.None); }
            catch { _ws = null; }
        }
    }

    public void Enqueue(string line)
    {
        if (_ws is not { State: WebSocketState.Open }) return; // sin cliente: descartar (es telemetria viva)
        _q.TryAdd(line); // TryAdd no bloquea; si la cola esta llena, dropeamos el evento mas viejo de facto
    }
}
