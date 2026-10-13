package main

import (
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticFilesAndBoundaries(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("<html>preview</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "app.mjs"), []byte("export const value=123;"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directory, "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	host := "127.0.0.1:18765"
	serve := handler(root, host, "test")
	for _, item := range []struct {
		method, path, requestHost string
		status                    int
	}{
		{"GET", "/", host, 200}, {"GET", "/app.mjs", host, 200}, {"HEAD", "/app.mjs", host, 200},
		{"POST", "/", host, 405}, {"GET", "/empty/", host, 404}, {"GET", "/../secret", host, 404},
		{"GET", "/.hidden", host, 404}, {"GET", "/app.mjs:stream", host, 404}, {"GET", "/", "untrusted.example", 403},
		{"GET", "/__portable__/health", host, 200},
	} {
		r := httptest.NewRequest(item.method, "http://"+host+item.path, nil)
		r.Host = item.requestHost
		w := httptest.NewRecorder()
		serve.ServeHTTP(w, r)
		if w.Code != item.status {
			t.Errorf("%s %s: %d", item.method, item.path, w.Code)
		}
		if item.path == "/app.mjs" && w.Code == 200 && !strings.HasPrefix(w.Header().Get("Content-Type"), "text/javascript") {
			t.Fatal("模块 MIME 类型错误")
		}
		if item.method == "HEAD" && w.Body.Len() != 0 {
			t.Fatal("HEAD 不应返回正文")
		}
	}
	r := httptest.NewRequest("GET", "http://"+host+"/app.mjs", nil)
	r.Header.Set("Range", "bytes=0-5")
	w := httptest.NewRecorder()
	serve.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "export" {
		t.Fatal("分段读取失败")
	}
}

func TestSymlinkCannotEscape(t *testing.T) {
	directory := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(outside, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(directory, "escape")); err != nil {
		t.Skip("当前系统未提供创建符号链接的权限")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	w := httptest.NewRecorder()
	handler(root, "127.0.0.1:18765", "test").ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:18765/escape", nil))
	body, _ := io.ReadAll(w.Result().Body)
	if w.Code != 404 || strings.Contains(string(body), "private") {
		t.Fatal("越过静态目录边界")
	}
}
