// Core Audio 进程分流探针（macOS 14.2+）：不依赖 BlackHole/多输出设备，直接抓系统音频
// 用法：taptest [秒数]   —— 输出 TAPSTATUS / LEVELS / MAX 到 stdout 与 /tmp/taptest.log
import CoreAudio
import Foundation

let LOG = "/tmp/taptest.log"
func log(_ s: String) {
  print(s); fflush(stdout)
  if let h = FileHandle(forWritingAtPath: LOG) ?? { FileManager.default.createFile(atPath: LOG, contents: nil); return FileHandle(forWritingAtPath: LOG) }() {
    h.seekToEndOfFile(); h.write(Data((s + "\n").utf8)); try? h.synchronize(); h.closeFile()
  }
}

func deviceUID(_ d: AudioDeviceID) -> String? {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var n: CFString? = nil
  var size = UInt32(MemoryLayout<CFString?>.size)
  guard AudioObjectGetPropertyData(d, &addr, 0, nil, &size, &n) == 0, let s = n else { return nil }
  return s as String
}
func defaultOutputID() -> AudioDeviceID {
  var dev = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == 0 else { return 0 }
  return dev
}

let seconds = CommandLine.arguments.count > 1 ? (Double(CommandLine.arguments[1]) ?? 8) : 8
// 变体开关：主设备用哪个（默认物理扬声器/显示器），是否静音，是否只放 tap
let needle = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "扬声器"
let muted = CommandLine.arguments.contains("mute")
let tapOnly = CommandLine.arguments.contains("taponly")
func find(_ n: String) -> AudioDeviceID? {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == 0 else { return nil }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == 0 else { return nil }
  for d in ids {
    var naddr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var nm: CFString? = nil
    var nsize = UInt32(MemoryLayout<CFString?>.size)
    if AudioObjectGetPropertyData(d, &naddr, 0, nil, &nsize, &nm) == 0, let s = nm as String?, s.contains(n) { return d }
  }
  return nil
}
let outDev = find(needle) ?? defaultOutputID()
guard let outUID = deviceUID(outDev), outDev != 0 else { log("NO OUTPUT DEVICE"); exit(1) }
log("VARIANT needle=\(needle) muted=\(muted) tapOnly=\(tapOnly) outputUID=\(outUID)")

let tapDesc = CATapDescription()
tapDesc.uuid = UUID()
tapDesc.processes = []            // 空 = 全局系统音频
tapDesc.isPrivate = true
tapDesc.muteBehavior = muted ? .mutedWhenTapped : .unmuted
tapDesc.isMixdown = true
tapDesc.isMono = false

var tapID = AudioObjectID(kAudioObjectUnknown)
let tapErr = AudioHardwareCreateProcessTap(tapDesc, &tapID)
log("createTap status=\(tapErr) id=\(tapID)")
if tapErr != 0 { exit(1) }

let aggDesc: [String: Any] = [
  kAudioAggregateDeviceNameKey: "面试辅助-分流",
  kAudioAggregateDeviceUIDKey: "com.interviewassist.tap.\(UUID().uuidString)",
  kAudioAggregateDeviceMainSubDeviceKey: outUID,
  kAudioAggregateDeviceIsPrivateKey: 1,
  kAudioAggregateDeviceTapAutoStartKey: 1,
  kAudioAggregateDeviceSubDeviceListKey: tapOnly ? [] : [[kAudioSubDeviceUIDKey: outUID]],
  kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapDesc.uuid.uuidString, kAudioSubTapDriftCompensationKey: 1]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
let aggErr = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
log("createAggregate status=\(aggErr) id=\(aggID)")
if aggErr != 0 { exit(1) }

let start = Date()
var perSec: [Int: Float] = [:]
var maxRms: Float = 0
var chunks = 0

var procID: AudioDeviceIOProcID?
let ioErr = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
  let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer<AudioBufferList>(mutating: inData))
  var sum: Double = 0
  var n = 0
  for b in list {
    guard let data = b.mData else { continue }
    let p = data.bindMemory(to: Float32.self, capacity: Int(b.mDataByteSize) / 4)
    for i in 0..<Int(b.mDataByteSize) / 4 { let v = p[i]; sum += Double(v * v); n += 1 }
  }
  guard n > 0 else { return }
  chunks += 1
  let rms = Float(sqrt(sum / Double(n)))
  maxRms = max(maxRms, rms)
  let sec = Int(Date().timeIntervalSince(start))
  perSec[sec] = max(perSec[sec] ?? 0, rms)
}
log("ioProc status=\(ioErr)")
if let p = procID {
  let st = AudioDeviceStart(aggID, p)
  log("deviceStart status=\(st)")
}

Thread.sleep(forTimeInterval: seconds)
var parts: [String] = []
for i in 0..<Int(seconds) + 1 { parts.append(String(format: "%.5f", perSec[i] ?? 0)) }
log("CHUNKS \(chunks)")
log("LEVELS " + parts.joined(separator: ","))
log("MAX " + String(format: "%.5f", maxRms))
if let p = procID { AudioDeviceStop(aggID, p); AudioDeviceDestroyIOProcID(aggID, p) }
AudioHardwareDestroyProcessTap(tapID)
AudioHardwareDestroyAggregateDevice(aggID)
