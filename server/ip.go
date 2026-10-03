package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// clientIP — адрес игрока. За Caddy на этой же машине берётся из X-Forwarded-For
// (последний адрес — тот, что видел Caddy); заголовку от чужих адресов не верим.
func clientIP(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	remote = remote.Unmap()
	if !remote.IsLoopback() {
		return remote
	}
	xff := r.Header.Get("X-Forwarded-For")
	if xff == "" {
		return remote
	}
	parts := strings.Split(xff, ",")
	if ip, err := netip.ParseAddr(strings.TrimSpace(parts[len(parts)-1])); err == nil {
		return ip.Unmap()
	}
	return remote
}

// ipHash — HMAC-SHA256 от адреса с секретом сервера. Сам адрес нигде не сохраняется:
// хэш позволяет считать уникальные подключения, но не восстановить IP.
func ipHash(secret []byte, ip netip.Addr) string {
	if !ip.IsValid() {
		return ""
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(ip.AsSlice())
	return hex.EncodeToString(mac.Sum(nil))
}
