// Draws the EasyAccess app icon (1024×1024 PNG): "EA" in the dashboard's coral on its dark panel colours.
// Usage: swift make-icon.swift out.png
import AppKit

let size = 1024.0
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

func rgb(_ hex: Int, _ a: Double = 1) -> NSColor {
  NSColor(srgbRed: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, alpha: a)
}

// macOS icon grid: 824pt rounded square centred on the canvas, with a soft drop shadow
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
shadow.shadowBlurRadius = 24
shadow.shadowOffset = NSSize(width: 0, height: -10)
shadow.set()
rgb(0x16171b).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()

// dashboard panel colours: #1e1f25 (raised) at the top → #0d0e11 (page) at the bottom
NSGradient(starting: rgb(0x22232a), ending: rgb(0x0d0e11))!.draw(in: shape, angle: -90)
// the same warm coral glow the "next up" card has, from the top-right corner
NSGraphicsContext.saveGraphicsState()
shape.addClip()
NSGradient(colors: [rgb(0xf97362, 0.30), rgb(0xf97362, 0)])!
  .draw(fromCenter: NSPoint(x: 860, y: 900), radius: 0, toCenter: NSPoint(x: 860, y: 900), radius: 640, options: [])
NSGraphicsContext.restoreGraphicsState()
// hairline edge so it doesn't vanish on a dark Dock
rgb(0xffffff, 0.08).setStroke()
let edge = NSBezierPath(roundedRect: tile.insetBy(dx: 2, dy: 2), xRadius: 183, yRadius: 183)
edge.lineWidth = 4
edge.stroke()

// "EA": E in coral, A in the dashboard's light text colour
let font = NSFont.systemFont(ofSize: 400, weight: .heavy)
let text = NSMutableAttributedString()
text.append(NSAttributedString(string: "E", attributes: [.font: font, .foregroundColor: rgb(0xf97362), .kern: 6]))
text.append(NSAttributedString(string: "A", attributes: [.font: font, .foregroundColor: rgb(0xededf0)]))
let bounds = text.boundingRect(with: NSSize(width: 2000, height: 2000), options: [.usesLineFragmentOrigin])
// centre on the cap height (not the line box) so the letters sit optically in the middle
let capMid = font.capHeight / 2 - font.descender
let origin = NSPoint(x: size / 2 - bounds.width / 2, y: size / 2 - capMid + 14)
text.draw(at: origin)

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
