package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

const (
	whKeyboardLL = 13

	wmKeyDown    = 0x0100
	wmKeyUp      = 0x0101
	wmSysKeyDown = 0x0104
	wmSysKeyUp   = 0x0105

	vkRControl = 0xA3
	vkRMenu    = 0xA5

	llkhfInjected = 0x10
)

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	procSetWindowsHookEx = user32.NewProc("SetWindowsHookExW")
	procUnhookWindows    = user32.NewProc("UnhookWindowsHookEx")
	procCallNextHookEx   = user32.NewProc("CallNextHookEx")
	procGetMessage       = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessage  = user32.NewProc("DispatchMessageW")
	procGetModuleHandle  = kernel32.NewProc("GetModuleHandleW")
)

var (
	hookHandle   uintptr
	hookCallback uintptr
)

type point struct {
	X int32
	Y int32
}

type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	Private uint32
}

type kbdllhookstruct struct {
	VkCode      uint32
	ScanCode    uint32
	Flags       uint32
	Time        uint32
	DwExtraInfo uintptr
}

type helperMessage struct {
	Type   string `json:"type"`
	Hotkey string `json:"hotkey,omitempty"`
	State  string `json:"state,omitempty"`
}

func main() {
	runtime.LockOSThread()

	hookCallback = syscall.NewCallback(keyboardProc)

	var err error
	hookHandle, err = installHook()
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	defer func() {
		if hookHandle != 0 {
			_, _, _ = procUnhookWindows.Call(hookHandle)
		}
	}()

	writeMessage(helperMessage{Type: "ready"})

	var message msg
	for {
		ret, _, callErr := procGetMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		switch int32(ret) {
		case -1:
			fmt.Fprintln(os.Stderr, formatWindowsError("GetMessageW", callErr))
			os.Exit(1)
		case 0:
			return
		default:
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&message)))
			procDispatchMessage.Call(uintptr(unsafe.Pointer(&message)))
		}
	}
}

func installHook() (uintptr, error) {
	moduleHandle, _, _ := procGetModuleHandle.Call(0)
	handle, _, err := procSetWindowsHookEx.Call(
		uintptr(whKeyboardLL),
		hookCallback,
		moduleHandle,
		0,
	)
	if handle == 0 {
		return 0, fmt.Errorf(formatWindowsError("SetWindowsHookExW", err))
	}

	return handle, nil
}

func keyboardProc(nCode int, wParam uintptr, lParam uintptr) uintptr {
	if nCode >= 0 {
		hookData := (*kbdllhookstruct)(unsafe.Pointer(lParam))

		if hookData.Flags&llkhfInjected == 0 {
			if hotkey, state, ok := mapHotkeyEvent(uint32(wParam), hookData.VkCode); ok {
				writeMessage(helperMessage{
					Type:   "hotkey",
					Hotkey: hotkey,
					State:  state,
				})
			}
		}
	}

	result, _, _ := procCallNextHookEx.Call(0, uintptr(nCode), wParam, lParam)
	return result
}

func mapHotkeyEvent(message uint32, vkCode uint32) (string, string, bool) {
	var hotkey string

	switch vkCode {
	case vkRControl:
		hotkey = "RCtrl"
	case vkRMenu:
		hotkey = "RAlt"
	default:
		return "", "", false
	}

	switch message {
	case wmKeyDown, wmSysKeyDown:
		return hotkey, "DOWN", true
	case wmKeyUp, wmSysKeyUp:
		return hotkey, "UP", true
	default:
		return "", "", false
	}
}

func writeMessage(message helperMessage) {
	encoded, err := json.Marshal(message)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		return
	}

	_, _ = os.Stdout.Write(append(encoded, '\n'))
}

func formatWindowsError(operation string, err error) string {
	if err == nil || err == syscall.Errno(0) {
		return fmt.Sprintf("%s failed", operation)
	}

	return fmt.Sprintf("%s failed: %v", operation, err)
}
