// 可行性探针：用 ScreenCaptureKit 采集系统音频（不含视频内容），打印音频格式与每秒电平。
// 用法：sckaudio [秒数]   —— 输出 AUDIOINFO 行与 LEVEL 行，二进制 PCM 写 /tmp/sck.pcm（调试用）
import Foundation
import ScreenCaptureKit
import CoreMedia
import AVFoundation

class Rec: NSObject, SCStreamOutput, SCStreamDelegate {
    var seconds: Double
    var start = Date()
    var perSec: [Int: Float] = [:]
    var maxRms: Float = 0
    var pcm = Data()
    var printedInfo = false
    var error: String?

    init(seconds: Double) { self.seconds = seconds; super.init() }

    var videoFrames = 0
    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .screen {
            videoFrames += 1
            if videoFrames == 1 || videoFrames % 5 == 0 { print("VIDEO frame=\(videoFrames)"); fflush(stdout) }
            return
        }
        guard type == .audio else { return }
        guard let desc = CMSampleBufferGetFormatDescription(sb), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc) else { return }
        if !printedInfo {
            printedInfo = true
            print("AUDIOINFO rate=\(asbd.pointee.mSampleRate) ch=\(asbd.pointee.mChannelsPerFrame) bits=\(asbd.pointee.mBitsPerChannel) float=\(asbd.pointee.mFormatFlags & kAudioFormatFlagIsFloat != 0) interleaved=\(asbd.pointee.mFormatFlags & kAudioFormatFlagIsPacked != 0)")
            fflush(stdout)
        }
        var size = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sb, bufferListSizeNeededOut: &size, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        if size == 0 { return }
        let abl = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 8).bindMemory(to: AudioBufferList.self, capacity: 1)
        defer { abl.deallocate() }
        var block: CMBlockBuffer?
        let st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sb, bufferListSizeNeededOut: nil, bufferListOut: abl, bufferListSize: size,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard st == noErr else { return }
        let bufs = UnsafeMutableAudioBufferListPointer(abl)
        var sum: Double = 0
        var n = 0
        for b in bufs {
            guard let data = b.mData else { continue }
            if asbd.pointee.mFormatFlags & kAudioFormatFlagIsFloat != 0 {
                let p = data.bindMemory(to: Float32.self, capacity: Int(b.mDataByteSize) / 4)
                for i in 0..<Int(b.mDataByteSize) / 4 { let v = p[i]; sum += Double(v * v); n += 1 }
            } else {
                let p = data.bindMemory(to: Int16.self, capacity: Int(b.mDataByteSize) / 2)
                for i in 0..<Int(b.mDataByteSize) / 2 { let v = Float(p[i]) / 32768; sum += Double(v * v); n += 1 }
            }
        }
        guard n > 0 else { return }
        let rms = Float(sqrt(sum / Double(n)))
        maxRms = max(maxRms, rms)
        let sec = Int(Date().timeIntervalSince(start))
        perSec[sec] = max(perSec[sec] ?? 0, rms)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        self.error = String(describing: error)
        CFRunLoopStop(CFRunLoopGetMain())
    }

    func report() {
        log("VIDEOFRAMES \(videoFrames)")
        var parts: [String] = []
        for i in 0..<Int(seconds) + 1 { parts.append(String(format: "%.5f", perSec[i] ?? 0)) }
        log("LEVELS " + parts.joined(separator: ","))
        log("MAX " + String(format: "%.5f", maxRms))
        if let e = error { log("ERROR " + e) }
    }
}

// 打成 .app 包后用 open 启动读不到 stdout，所以同时落一份到文件
let LOG_PATH = "/tmp/sckaudio_report.txt"
func log(_ s: String) {
    print(s)
    fflush(stdout)
    let handle = FileHandle(forWritingAtPath: LOG_PATH) ?? {
        FileManager.default.createFile(atPath: LOG_PATH, contents: nil)
        return FileHandle(forWritingAtPath: LOG_PATH)
    }()
    handle?.seekToEndOfFile()
    handle?.write(Data((s + "\n").utf8))
    try? handle?.synchronize()
    handle?.closeFile()
}

let seconds = CommandLine.arguments.count > 1 ? (Double(CommandLine.arguments[1]) ?? 8) : 8
let rec = Rec(seconds: seconds)

let sem = DispatchSemaphore(value: 0)
SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, err in
    if let err = err { print("SCKERR \(err)"); fflush(stdout); sem.signal(); return }
    guard let display = content?.displays.first else { print("SCKERR no display"); fflush(stdout); sem.signal(); return }
    print("CONTENT displays=\(content?.displays.count ?? -1) apps=\(content?.applications.count ?? -1) windows=\(content?.windows.count ?? -1)")
    fflush(stdout)
    // 关键：音频只交付给「被包含进过滤器」的应用；纯 display 过滤器实测一个音频包都不给
    let includeApps = CommandLine.arguments.contains("apps")
    print("FILTER \(includeApps ? "apps" : "display")")
    fflush(stdout)
    let filter = includeApps
        ? SCContentFilter(display: display, including: content?.applications ?? [], exceptingWindows: [])
        : SCContentFilter(display: display, excludingWindows: [])
    let config = SCStreamConfiguration()
    config.capturesAudio = true
    config.excludesCurrentProcessAudio = true
    config.sampleRate = 48000
    config.channelCount = 2 // 苹果样例用 2 声道
    config.width = 1280
    config.height = 720
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30) // 别把帧率压太低：音频可能随视频帧产出
    config.queueDepth = 5
    let stream = SCStream(filter: filter, configuration: config, delegate: rec)
    do {
        try stream.addStreamOutput(rec, type: .audio, sampleHandlerQueue: DispatchQueue(label: "sckaudio"))
        try stream.addStreamOutput(rec, type: .screen, sampleHandlerQueue: DispatchQueue(label: "sckscreen"))
        stream.startCapture { e in
            if let e = e { print("STARTERR \(e)"); fflush(stdout) }
        }
    } catch { print("SCKERR add \(error)"); fflush(stdout); sem.signal(); return }
    sem.signal()
}
sem.wait()

Thread.sleep(forTimeInterval: seconds)
rec.report()
