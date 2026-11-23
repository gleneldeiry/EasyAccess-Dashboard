// EasyAccess — native macOS wrapper around the local dashboard.
// Starts `node server.js` if it isn't already running, shows the page in a WebKit window,
// opens outside links in your browser, turns the page's alerts into Mac notifications,
// and stops the server again when you quit (only if this app started it).
//
// Built by desktop/build.sh, which fills in the project folder below.

import Cocoa
import WebKit
import UserNotifications

let projectDir = "__PROJECT_DIR__"
let logFile = NSString(string: "~/Library/Logs/EasyAccess.log").expandingTildeInPath

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
                         WKScriptMessageHandler, UNUserNotificationCenterDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var server: Process?
  var port = 3000
  var baseURL: URL { URL(string: "http://localhost:\(port)/")! }

  // MARK: launch

  func applicationDidFinishLaunching(_ notification: Notification) {
    port = readPort()
    buildMenu()
    buildWindow()
    UNUserNotificationCenter.current().delegate = self
    showSplash()
    DispatchQueue.global().async { self.startAndLoad() }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    window.makeKeyAndOrderFront(nil)
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    server?.terminate() // only set when this app started the server
  }

  func readPort() -> Int {
    guard let env = try? String(contentsOfFile: projectDir + "/.env", encoding: .utf8) else { return 3000 }
    for line in env.split(separator: "\n") where line.hasPrefix("PORT=") {
      return Int(line.dropFirst(5).trimmingCharacters(in: .whitespaces)) ?? 3000
    }
    return 3000
  }

  // MARK: server

  func isUp() -> Bool {
    var req = URLRequest(url: baseURL.appendingPathComponent("styles.css"))
    req.timeoutInterval = 1
    let done = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: req) { _, res, _ in
      ok = (res as? HTTPURLResponse)?.statusCode == 200
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 2)
    return ok
  }

  func startAndLoad() {
    if !isUp() {
      FileManager.default.createFile(atPath: logFile, contents: nil)
      let log = FileHandle(forWritingAtPath: logFile)
      let p = Process()
      // a login shell so Homebrew / nvm installs of node are on PATH
      p.executableURL = URL(fileURLWithPath: "/bin/zsh")
      p.arguments = ["-lc", "[ -d node_modules ] || npm install; exec node server.js"]
      p.currentDirectoryURL = URL(fileURLWithPath: projectDir)
      p.standardOutput = log
      p.standardError = log
      do { try p.run(); server = p } catch {
        return fail("Couldn't start Node.js: \(error.localizedDescription)")
      }
      let deadline = Date().addingTimeInterval(45)
      while !isUp() {
        if !p.isRunning { return fail("The dashboard server stopped while starting.") }
        if Date() > deadline { return fail("The dashboard took too long to start.") }
        Thread.sleep(forTimeInterval: 0.3)
      }
    }
    DispatchQueue.main.async { self.webView.load(URLRequest(url: self.baseURL)) }
  }

  func fail(_ message: String) {
    DispatchQueue.main.async {
      self.showMessage("\(message)<br><br>Details are in <code>~/Library/Logs/EasyAccess.log</code>. "
        + "Check that Node.js is installed and the project is still at<br><code>\(projectDir)</code>")
    }
  }

  // MARK: window + menu

  func buildWindow() {
    let config = WKWebViewConfiguration()
    let bridge = """
    (() => {
      const post = (m) => window.webkit.messageHandlers.notify.postMessage(m);
      class MacNotification {
        constructor(title, opts = {}) { post({ title: String(title), body: String(opts.body || ''), url: (opts.data && opts.data.url) || '' }); }
        static get permission() { return 'granted'; }
        static requestPermission() { post({ ask: true }); return Promise.resolve('granted'); }
      }
      window.Notification = MacNotification;
    })();
    """
    config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.add(self, name: "notify")

    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsMagnification = true
    webView.underPageBackgroundColor = NSColor(red: 0.05, green: 0.055, blue: 0.067, alpha: 1)

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                      backing: .buffered, defer: false)
    window.title = "EasyAccess"
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.minSize = NSSize(width: 900, height: 600)
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("EasyAccessMain") // remembers size and position
    window.makeKeyAndOrderFront(nil)
  }

  func buildMenu() {
    let main = NSMenu()
    func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      return i
    }
    let app = NSMenu()
    app.addItem(item("About EasyAccess", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""))
    app.addItem(.separator())
    app.addItem(item("Hide EasyAccess", #selector(NSApplication.hide(_:)), "h"))
    app.addItem(item("Quit EasyAccess", #selector(NSApplication.terminate(_:)), "q"))
    let edit = NSMenu(title: "Edit")
    edit.addItem(item("Undo", Selector(("undo:")), "z"))
    edit.addItem(item("Redo", Selector(("redo:")), "z", [.command, .shift]))
    edit.addItem(.separator())
    edit.addItem(item("Cut", #selector(NSText.cut(_:)), "x"))
    edit.addItem(item("Copy", #selector(NSText.copy(_:)), "c"))
    edit.addItem(item("Paste", #selector(NSText.paste(_:)), "v"))
    edit.addItem(item("Select All", #selector(NSText.selectAll(_:)), "a"))
    let view = NSMenu(title: "View")
    view.addItem(item("Refresh Data", #selector(refreshData), "r"))
    view.addItem(item("Reload Page", #selector(reloadPage), "r", [.command, .shift]))
    view.addItem(.separator())
    view.addItem(item("Actual Size", #selector(zoomReset), "0"))
    view.addItem(item("Zoom In", #selector(zoomIn), "+"))
    view.addItem(item("Zoom Out", #selector(zoomOut), "-"))
    let win = NSMenu(title: "Window")
    win.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
    win.addItem(item("Zoom", #selector(NSWindow.performZoom(_:)), ""))
    for (title, menu) in [("EasyAccess", app), ("Edit", edit), ("View", view), ("Window", win)] {
      let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      top.submenu = menu
      main.addItem(top)
    }
    NSApp.mainMenu = main
    NSApp.windowsMenu = win
  }

  @objc func refreshData() { webView.evaluateJavaScript("typeof load === 'function' && load(true)") }
  @objc func reloadPage() { webView.load(URLRequest(url: baseURL)) }
  @objc func zoomReset() { webView.pageZoom = 1 }
  @objc func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2) }
  @objc func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }

  // Same "ES" as the page's loading splash, in the same spot, so the hand-off is seamless
  func showSplash() {
    webView.loadHTMLString("""
      <html><head><style>
      :root { --bg: #f5f5f7; --accent: #f97362; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0d0e11; } }
      body { margin: 0; height: 100vh; display: grid; place-content: center; background: var(--bg); }
      div { color: var(--accent); letter-spacing: .06em; white-space: pre; padding-bottom: 29px;
        font: 800 clamp(40px, 7vw, 80px)/1 -apple-system, BlinkMacSystemFont, sans-serif;
        animation: breathe 1.6s ease-in-out infinite; }
      @keyframes breathe { 50% { opacity: .55; } }
      </style></head><body><div>ES</div></body></html>
      """, baseURL: nil)
  }

  func showMessage(_ html: String) {
    webView.loadHTMLString("""
      <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0e11;color:#8d909c;
      font:15px -apple-system,sans-serif;text-align:center;line-height:1.6"><div>\(html)</div>
      <style>code{color:#ededf0;font-size:13px}</style></body></html>
      """, baseURL: nil)
  }

  // MARK: links — the dashboard stays in the app, everything else opens in your browser

  func isDashboard(_ url: URL?) -> Bool {
    guard let url else { return false }
    return url.host == "localhost" || url.scheme == "about"
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = action.request.url, !isDashboard(url), action.targetFrame?.isMainFrame ?? true {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) } // target="_blank" links
    return nil
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  // server restarted or went away: try again shortly
  func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
    let e = error as NSError
    let unreachable = e.domain == NSURLErrorDomain &&
      [NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut].contains(e.code)
    guard unreachable else { return } // e.g. a link we sent to the browser instead
    showMessage("Reconnecting to the dashboard…")
    DispatchQueue.global().asyncAfter(deadline: .now() + 2) { self.startAndLoad() }
  }

  // MARK: notifications (page alerts → macOS notifications)

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let msg = message.body as? [String: Any] else { return }
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
      guard granted, let title = msg["title"] as? String else { return }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = msg["body"] as? String ?? ""
      content.sound = .default
      if let url = msg["url"] as? String, !url.isEmpty { content.userInfo = ["url": url] }
      center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler done: @escaping () -> Void) {
    if let s = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: s) {
      NSWorkspace.shared.open(url)
    } else {
      window.makeKeyAndOrderFront(nil)
      NSApp.activate()
    }
    done()
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate()
app.run()
