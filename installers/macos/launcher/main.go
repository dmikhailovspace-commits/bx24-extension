package main

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func contentsRoot() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(filepath.Dir(executable)), nil
}

func openLog() io.WriteCloser {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	logDir := filepath.Join(home, "Library", "Logs")
	if os.MkdirAll(logDir, 0755) != nil {
		return nil
	}
	logFile, err := os.OpenFile(filepath.Join(logDir, "PENA BX24 Installer.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil
	}
	return logFile
}

func runInstaller(script string) int {
	command := exec.Command("/bin/bash", script)
	command.Stdin = nil
	if logFile := openLog(); logFile != nil {
		defer logFile.Close()
		command.Stdout = logFile
		command.Stderr = logFile
	}
	if err := command.Run(); err != nil {
		return 1
	}
	return 0
}

func readPath(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(data), "\r\n"), nil
}

func runBitrix(resources string) int {
	bitrixExecutable, err := readPath(filepath.Join(resources, "bitrix-executable.path"))
	if err != nil || !filepath.IsAbs(bitrixExecutable) {
		return 1
	}
	extensionDir, err := readPath(filepath.Join(resources, "extension-directory.path"))
	if err != nil || !filepath.IsAbs(extensionDir) {
		return 1
	}
	argv := []string{
		bitrixExecutable,
		"--disable-extensions-except=" + extensionDir,
		"--load-extension=" + extensionDir,
	}
	if err := syscall.Exec(bitrixExecutable, argv, os.Environ()); err != nil {
		return 1
	}
	return 0
}

func main() {
	contents, err := contentsRoot()
	if err != nil {
		os.Exit(1)
	}
	resources := filepath.Join(contents, "Resources")
	installerScript := filepath.Join(resources, "install-gui.sh")
	if info, statErr := os.Stat(installerScript); statErr == nil && !info.IsDir() {
		os.Exit(runInstaller(installerScript))
	}
	os.Exit(runBitrix(resources))
}
