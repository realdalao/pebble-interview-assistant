// setroute — 面试辅助的路由工具
// fix            把默认输出切到「多输出设备」，打印 "OK <切换前的设备名>"
// set <名字片段> 把默认输出切到名字含该片段的设备
// current        打印当前默认输出设备名
// list           打印所有设备
import CoreAudio
import Foundation

func getDevices() -> [AudioDeviceID] {
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == 0 else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == 0 else { return [] }
  return ids
}

func getString(_ selector: AudioObjectPropertySelector, device: AudioDeviceID) -> String {
  var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var name: CFString? = nil
  var size = UInt32(MemoryLayout<CFString?>.size)
  let status = withUnsafeMutablePointer(to: &name) { ptr in
    AudioObjectGetPropertyData(device, &addr, 0, nil, &size, ptr)
  }
  guard status == 0, let s = name else { return "" }
  return s as String
}

func defaultOutput() -> (AudioDeviceID, String) {
  var dev = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == 0 else { return (0, "") }
  return (dev, getString(kAudioObjectPropertyName, device: dev))
}

func setDefault(_ device: AudioDeviceID) -> Bool {
  var dev = device
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &dev) == 0
}

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "fix"

if mode == "list" {
  for id in getDevices() {
    let name = getString(kAudioObjectPropertyName, device: id)
    if !name.isEmpty { print("\(id)\t\(name)") }
  }
  exit(0)
}
if mode == "current" {
  print(defaultOutput().1)
  exit(0)
}
if mode == "set", args.count > 2 {
  let needle = args[2]
  guard let target = getDevices().first(where: { getString(kAudioObjectPropertyName, device: $0).contains(needle) }) else {
    print("NOMATCH"); exit(2)
  }
  print(setDefault(target) ? "OK" : "FAIL")
  exit(0)
}
// fix
let current = defaultOutput()
if current.1.contains("多输出") { print("OK \(current.1)"); exit(0) } // 已是目标，无需切换
guard let target = getDevices().first(where: { getString(kAudioObjectPropertyName, device: $0).contains("多输出") }) else {
  print("NOMATCH"); exit(2)
}
if setDefault(target) {
  print("OK \(current.1)")
} else {
  print("FAIL"); exit(1)
}
