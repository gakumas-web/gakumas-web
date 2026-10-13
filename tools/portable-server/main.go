package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type releaseInfo struct {
	Project string `json:"project"`
	Format  int    `json:"format"`
	Version string `json:"version"`
}

// 只在 exe 相邻的 www 目录提供静态文件，不接收账号上传或开放目录浏览。
func handler(root *os.Root, host, version string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cache-Control", "no-cache")
		if r.Host != host {
			http.Error(w, "仅支持本机地址访问", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "仅支持读取静态文件", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/__portable__/health" {
			w.Header().Set("Content-Type", "application/json")
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]string{"application": "gakumas-web-portable", "version": version})
			}
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if strings.HasSuffix(name, "/") {
			name += "index.html"
		}
		if !fs.ValidPath(name) || strings.ContainsAny(name, "\\:") {
			http.NotFound(w, r)
			return
		}
		for _, part := range strings.Split(name, "/") {
			if strings.HasPrefix(part, ".") {
				http.NotFound(w, r)
				return
			}
		}
		file, err := root.Open(name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		// Windows 的系统 MIME 注册表可能未识别原生模块，显式声明浏览器入口类型。
		switch strings.ToLower(filepath.Ext(name)) {
		case ".js", ".mjs":
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		case ".json":
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		case ".css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		case ".html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		case ".wasm":
			w.Header().Set("Content-Type", "application/wasm")
		}
		http.ServeContent(w, r, name, info.ModTime(), file)
	})
}

func openBrowser(url string) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	if err := command.Start(); err != nil {
		fmt.Println("浏览器未能自动打开，请手动访问上方地址。")
		return
	}
	go func() { _ = command.Wait() }()
}

func run(directory string, port int, noBrowser bool) error {
	if port < 0 || port > 65535 {
		return errors.New("端口须在 0～65535 之间")
	}
	if directory == "" {
		executable, err := os.Executable()
		if err != nil {
			return errors.New("无法定位启动器目录")
		}
		directory = filepath.Join(filepath.Dir(executable), "www")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return errors.New("找不到 www 目录，请完整解压便携包后启动")
	}
	defer root.Close()
	raw, err := root.ReadFile("release.json")
	if err != nil {
		return errors.New("缺少程序发布清单，请重新解压完整便携包")
	}
	var release releaseInfo
	if json.Unmarshal(raw, &release) != nil || release.Project != "gakumas-web" || release.Format != 1 || release.Version == "" {
		return errors.New("程序发布清单无效")
	}
	if _, err := root.Stat("index.html"); err != nil {
		return errors.New("缺少网页入口，请重新解压完整便携包")
	}
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("无法监听本机端口 %d；请关闭占用该端口的服务后重试", port)
	}
	defer listener.Close()
	host := listener.Addr().String()
	server := &http.Server{Handler: handler(root, host, release.Version), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		timeout, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(timeout)
	}()
	url := "http://" + host + "/"
	fmt.Println("回忆整理室本地服务 · " + release.Version)
	fmt.Println("READY " + url)
	fmt.Println("关闭此窗口或按 Ctrl+C 停止服务。账号数据仍保存在浏览器中。")
	if !noBrowser {
		go openBrowser(url)
	}
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func main() {
	directory := flag.String("directory", "", "静态站点目录，默认使用启动器旁的 www")
	port := flag.Int("port", 18765, "本地端口；0 仅用于自动化测试")
	noBrowser := flag.Bool("no-browser", false, "不自动打开浏览器，失败时不等待输入")
	flag.Parse()
	if err := run(*directory, *port, *noBrowser); err != nil {
		fmt.Fprintln(os.Stderr, "启动失败：", err)
		if !*noBrowser {
			fmt.Fprintln(os.Stderr, "按回车关闭窗口。")
			_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		}
		os.Exit(1)
	}
}
