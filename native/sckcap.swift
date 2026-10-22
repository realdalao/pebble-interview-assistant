// ScreenCaptureKit 系统音频采集助手：把系统音频转成 16kHz/单声道/Int16 PCM 写到 stdout，
// 主进程直接分片送 ASR（不再需要 BlackHole / 多输出设备）。
// 用法：sckcap [--seconds N] [--synthetic]  —— 状态与诊断走 stderr，音频裸流走 stdout
// --synthetic：不接 SCK，直接输出 440Hz 正弦（用于验证「管道→主进程→ASR」整条链路）
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

// stderr 给主进程看；同时落一份文件，方便用 open 启动（无 stdout/stderr）时排查
let APPTEST_LOG = "/tmp/sckcap-app.log"
func log(_ s: String) {
  let line = "SCKCAP " + s + "\n"
  FileHandle.standardError.write(Data(line.utf8))
  if FileManager.default.fileExists(atPath: APPTEST_LOG) {
    if let h = FileHandle(forWritingAtPath: APPTEST_LOG) {
      h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.synchronize(); h.closeFile()
    }
  }
}

let args = CommandLine.arguments
let synthetic = args.contains("--synthetic")
var seconds = 0.0
if let i = args.firstIndex(of: "--seconds"), i + 1 < args.count { seconds = Double(args[i + 1]) ?? 0 }

let OUT_RATE = 16000.0
let OUT_CH = AVAudioChannelCount(1)
guard let outFmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: OUT_RATE, channels: OUT_CH, interleaved: true) else {
  log("BAD_OUTFMT"); exit(1)
}

// ---- 合成音模式：验证管道链路，不依赖 SCK ----
if synthetic {
  log("MODE synthetic seconds=\(seconds)")
  let chunkSamples = 3200 // 200ms
  var phase = 0.0
  let buf = UnsafeMutablePointer<Int16>.allocate(capacity: chunkSamples)
  defer { buf.deallocate() }
  let start = Date()
  while seconds <= 0 || Date().timeIntervalSince(start) < seconds {
    for i in 0..<chunkSamples {
      buf[i] = Int16(8000 * sin(phase))
      phase += 2 * Double.pi * 440 / OUT_RATE
    }
    FileHandle.standardOutput.write(Data(bytes: buf, count: chunkSamples * 2))
    Thread.sleep(forTimeInterval: 0.2)
  }
  log("DONE")
  exit(0)
}

// ---- SCK 采集 ----
class Cap: NSObject, SCStreamOutput, SCStreamDelegate {
  let outFmt: AVAudioFormat
  init(outFmt: AVAudioFormat) { self.outFmt = outFmt; super.init() }
  var converter: AVAudioConverter?
  var inFmtKey = ""
  var outBuf: AVAudioPCMBuffer?
  var chunks = 0
  var maxRms: Float = 0
  var audioCalls = 0   // 回调被唤起的次数（哪怕样本数为 0）
  var screenCalls = 0

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    if type == .screen {
      screenCalls += 1
      if screenCalls <= 2 || screenCalls % 60 == 0 { log("SCREEN_CALL \(screenCalls)") }
      return
    }
    guard type == .audio else { return }
    audioCalls += 1
    if audioCalls <= 3 || audioCalls % 100 == 0 {
      log("AUDIO_CALL \(audioCalls) numSamples=\(CMSampleBufferGetNumSamples(sb))")
    }
    guard let desc = CMSampleBufferGetFormatDescription(sb),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc) else {
      if audioCalls <= 3 { log("NO_FMT_DESC") }; return
    }
    let inFmt = AVAudioFormat(cmAudioFormatDescription: desc)
    let n = Int(CMSampleBufferGetNumSamples(sb))
    guard n > 0 else { if audioCalls <= 3 { log("EMPTY_BUFFER") }; return }
    guard let pcmIn = AVAudioPCMBuffer(pcmFormat: inFmt, frameCapacity: AVAudioFrameCount(n)) else { return }
    pcmIn.frameLength = AVAudioFrameCount(n)
    guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sb, at: 0, frameCount: Int32(n), into: pcmIn.mutableAudioBufferList) == noErr else { return }

    let key = "\(inFmt.sampleRate)/\(inFmt.channelCount)/\(asbd.pointee.mFormatFlags)"
    if key != inFmtKey {
      converter = AVAudioConverter(from: inFmt, to: outFmt)
      inFmtKey = key
      log("AUDIOFMT in=\(inFmt.sampleRate)Hz ch=\(inFmt.channelCount) -> out=16k/1")
    }
    guard let conv = converter else { return }
    if outBuf == nil || outBuf!.frameCapacity < AVAudioFrameCount(Double(n) * OUT_RATE / inFmt.sampleRate + 64) {
      outBuf = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: AVAudioFrameCount(Double(n) * OUT_RATE / inFmt.sampleRate + 64))
    }
    guard let out = outBuf else { return }
    var consumed = false
    var err: NSError?
    let status = conv.convert(to: out, error: &err) { _, outStatus in
      if consumed { outStatus.pointee = .noDataNow; return nil }
      consumed = true
      outStatus.pointee = .haveData
      return pcmIn
    }
    if status == .error { if let e = err { log("CONVERR \(e.code)") }; return }
    let frames = Int(out.frameLength)
    guard frames > 0 else { return }
    let maxFrames = outFmt.sampleRate * 0.5
    if frames > Int(maxFrames) { log("TOOBIG \(frames)"); return }
    guard let ch0 = out.int16ChannelData else { return }
    var acc: Double = 0
    var idx = 0
    while idx < frames {
      let sample: Int16 = ch0[0][idx] // int16ChannelData 是「通道指针数组」，单声道取 [0]
      let f: Double = Double(sample) / 32768.0
      acc = acc + (f * f)
      idx = idx + 1
    }
    let rms = Float(sqrt(acc / Double(frames)))
    maxRms = max(maxRms, rms)
    chunks += 1
    if chunks == 1 || chunks % 50 == 0 { log("CHUNKS \(chunks) rms=\(rms)") }
    // ch0 是「通道指针数组」，ch0[0] 才是第 0 通道的样本区；直接写 ch0 会把指针值当音频
    FileHandle.standardOutput.write(Data(bytes: UnsafeMutableRawPointer(ch0[0]), count: frames * 2))
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) { log("STOPPED \(error)") }
}

let cap = Cap(outFmt: outFmt)
// SCStream 必须被强引用持有：若只在闭包内 let，闭包返回后 ARC 立刻释放它，流当场停（表现就是只有头两帧、音频 0 包）
var gStream: SCStream?
let sem = DispatchSemaphore(value: 0)
var started = false
SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, err in
  defer { sem.signal() }
  if let err = err { log("CONTENT_ERR \(err)"); return }
  guard let display = content?.displays.first else { log("NO_DISPLAY"); return }
  let apps = content?.applications ?? []
  log("CONTENT displays=\(content?.displays.count ?? 0) apps=\(apps.count)")
  // 音频只交付给被包含的应用；打印列表以便确认声源（如腾讯会议/ToneGUI）确实在内
  for a in apps.prefix(40) { log("APP \(a.bundleIdentifier) | \(a.applicationName)") }
  // 音频只交付给被包含的应用；全量包含 = 整屏系统声音
  let filter = args.contains("--display-only")
    ? SCContentFilter(display: display, excludingWindows: [])
    : SCContentFilter(display: display, including: apps, exceptingWindows: [])
  let cfg = SCStreamConfiguration()
  cfg.capturesAudio = true
  cfg.excludesCurrentProcessAudio = true
  cfg.sampleRate = 48000
  cfg.channelCount = 2
  cfg.width = 320
  cfg.height = 180
  cfg.minimumFrameInterval = CMTime(value: 1, timescale: 15)
  cfg.queueDepth = 5
  let stream = SCStream(filter: filter, configuration: cfg, delegate: cap)
  gStream = stream
  do {
    try stream.addStreamOutput(cap, type: .audio, sampleHandlerQueue: DispatchQueue(label: "sckcap.audio"))
    try stream.addStreamOutput(cap, type: .screen, sampleHandlerQueue: DispatchQueue(label: "sckcap.screen"))
    stream.startCapture { e in
      if let e = e { log("START_ERR \(e)") } else { log("STARTED") }
    }
    started = true
  } catch { log("ADD_ERR \(error)") }
}
sem.wait()
if !started { log("NOT_STARTED"); exit(1) }

if seconds > 0 {
  // 不能 Thread.sleep：会掐死主线程 RunLoop，SCStream 的回调派发跟着停
  let until = Date().addingTimeInterval(seconds)
  while Date() < until {
    RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.25))
  }
  log("DONE chunks=\(cap.chunks) maxRms=\(cap.maxRms) audioCalls=\(cap.audioCalls) screenCalls=\(cap.screenCalls)")
  exit(0)
}
RunLoop.main.run()
