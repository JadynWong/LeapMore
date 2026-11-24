import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
let size = 1024
guard arguments.count == 3,
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: arguments[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                              space: colorSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    throw CocoaError(.fileReadCorruptFile)
}

// The original artwork is transparent. Use the original launcher background under it.
let bounds = CGRect(x: 0, y: 0, width: size, height: size)
context.setFillColor(red: 243.0 / 255, green: 249.0 / 255, blue: 253.0 / 255, alpha: 1)
context.fill(bounds)
context.interpolationQuality = .high
context.draw(image, in: bounds)

let output = URL(fileURLWithPath: arguments[2]) as CFURL
guard let rendered = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(output, UTType.png.identifier as CFString, 1, nil) else {
    throw CocoaError(.fileWriteUnknown)
}
CGImageDestinationAddImage(destination, rendered, nil)
guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
