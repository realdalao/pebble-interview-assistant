// 程序化创建/销毁多输出聚合设备，并测试它能否被设为默认输出
// 用法：mkagg create | mkagg destroy | mkagg list
import CoreAudio
import Foundation

let NAME = "面试多输出"
let UID = "com.interviewassist.multiout"

func str(_ d: AudioDeviceID, _ sel: AudioObjectPropertySelector) -> String? {
  var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var n: CFString? = nil
  var size = UInt32(MemoryLayout<CFString?>.size)
  guard AudioObjectGetPropertyData(d, &addr, 0, nil, &size, &n) == 0, let s = n else { return nil }
  return s as String
}
func devices() -> [AudioDeviceID] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == 0 else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == 0 else { return [] }
  return ids
}
func find(_ needle: String) -> (AudioDeviceID, String)? {
  for d in devices() {
    if let n = str(d, kAudioObjectPropertyName), n.contains(needle) {
      if let uid = str(d, kAudioDevicePropertyDeviceUID) { return (d, uid) }
    }
  }
  for d in devices() {
    if let n = str(d, kAudioObjectPropertyName), n.contains(needle), let uid = str(d, kAudioDevicePropertyDeviceUID) { return (d, uid) }
  }
  return nil
}
func pluginID() -> AudioObjectID? {
  // 优先按 bundle id 查；失败就退到插件列表的第一个（HAL 插件通常只有一个）
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyPlugInForBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var pid = AudioObjectID(0)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  let bundle = "com.apple.audio.CoreAudio" as CFString
  let st = withUnsafePointer(to: bundle) { bp -> OSStatus in
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, UInt32(MemoryLayout<CFString>.size), bp, &size, &pid)
  }
  if st == 0 && pid != 0 { return pid }
  var laddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyPlugInList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var lsize: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &laddr, 0, nil, &lsize) == 0, lsize > 0 else { return nil }
  var ids = [AudioObjectID](repeating: 0, count: Int(lsize) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &laddr, 0, nil, &lsize, &ids) == 0 else { return nil }
  return ids.first
}
func setDefault(_ d: AudioDeviceID) -> OSStatus {
  var dev = d
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &dev)
}
func currentName() -> String {
  var dev = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == 0 else { return "?" }
  return str(dev, kAudioObjectPropertyName) ?? "?"
}

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "list"

if mode == "list" {
  for d in devices() {
    print("\(d)\t\(str(d, kAudioObjectPropertyName) ?? "?")\t\(str(d, kAudioDevicePropertyDeviceUID) ?? "?")")
  }
  exit(0)
}
if mode == "destroy" {
  guard let existing = find(NAME) else { print("NOEXIST"); exit(0) }
  var dev = existing.0
  var addr = AudioObjectPropertyAddress(mSelector: kAudioPlugInDestroyAggregateDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  guard let pid = pluginID() else { print("NOPLUGIN"); exit(1) }
  let st = AudioObjectSetPropertyData(pid, &addr, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &dev)
  print("destroy status=\(st)"); exit(0)
}
guard let pid = pluginID() else { print("NOPLUGIN"); exit(1) }
guard let monitor = find("Mi Monitor") else { print("NO MONITOR"); exit(1) }
guard let blackhole = find("BlackHole") else { print("NO BLACKHOLE"); exit(1) }
print("plugin=\(pid) monitor=\(monitor.1) blackhole=\(blackhole.1) current=\(currentName())")

let subList: [[String: Any]] = [
  [kAudioSubDeviceUIDKey: monitor.1, kAudioSubDeviceDriftCompensationKey: 0],
  [kAudioSubDeviceUIDKey: blackhole.1, kAudioSubDeviceDriftCompensationKey: 1],
]
let desc: [String: Any] = [
  kAudioAggregateDeviceNameKey: NAME,
  kAudioAggregateDeviceUIDKey: UID,
  kAudioAggregateDeviceMainSubDeviceKey: monitor.1,
  kAudioAggregateDeviceIsPrivateKey: 0,
  kAudioAggregateDeviceIsStackedKey: 1,
  kAudioAggregateDeviceSubDeviceListKey: subList,
]
// 属性数据就是描述字典本身，创建出来的设备 ID 之后按 UID 反查
var addr = AudioObjectPropertyAddress(mSelector: kAudioPlugInCreateAggregateDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var cf: CFDictionary? = desc as CFDictionary
let st = withUnsafeMutablePointer(to: &cf) { dp in
  AudioObjectSetPropertyData(pid, &addr, 0, nil, UInt32(MemoryLayout<CFDictionary?>.size), dp)
}
print("create status=\(st)")
Thread.sleep(forTimeInterval: 0.6)
let after = find(NAME)
print("found after create: \(after.map { "id=\($0.0) uid=\($0.1)" } ?? "NOT FOUND")")
if let a = after {
  let s = setDefault(a.0)
  Thread.sleep(forTimeInterval: 1.0)
  print("setStatus=\(s) current=\(currentName())")
}
