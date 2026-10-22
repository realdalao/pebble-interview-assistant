// 验证：先对聚合设备 start IO，再设为默认输出，是否就能生效
import CoreAudio
import Foundation

func devices() -> [AudioDeviceID] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == 0 else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == 0 else { return [] }
  return ids
}
func name(_ d: AudioDeviceID) -> String {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var n: CFString? = nil
  var size = UInt32(MemoryLayout<CFString?>.size)
  let st = withUnsafeMutablePointer(to: &n) { AudioObjectGetPropertyData(d, &addr, 0, nil, &size, $0) }
  guard st == 0, let s = n else { return "" }
  return s as String
}
func currentID() -> AudioDeviceID {
  var dev = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == 0 else { return 0 }
  return dev
}
func setDefault(_ d: AudioDeviceID) -> OSStatus {
  var dev = d
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &dev)
}
let ioProc: AudioDeviceIOProc = { _, _, _, _, _, _, _ in noErr }

let needle = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "多输出"
var lines: [String] = []
lines.append("before=\(name(currentID()))")
guard let target = devices().first(where: { name($0).contains(needle) }) else {
  lines.append("NOMATCH")
  try? (lines.joined(separator: "\n") + "\n").write(toFile: "/tmp/setstart.log", atomically: true, encoding: .utf8)
  exit(2)
}
lines.append("target=\(name(target)) id=\(target)")
var procID: AudioDeviceIOProcID?
let s1 = AudioDeviceCreateIOProcID(target, ioProc, nil, &procID)
let s2 = AudioDeviceStart(target, procID)
lines.append("createProc=\(s1) start=\(s2)")
Thread.sleep(forTimeInterval: 0.5)
let s3 = setDefault(target)
lines.append("setStatus=\(s3)")
Thread.sleep(forTimeInterval: 1.0)
lines.append("after=\(name(currentID()))")
let out = lines.joined(separator: "\n") + "\n"
print(out)
try? out.write(toFile: "/tmp/setstart.log", atomically: true, encoding: .utf8)
