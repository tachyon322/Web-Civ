// Пакет geo определяет страну по IP через офлайн-базу в формате MaxMind DB
// (например, бесплатная DB-IP «IP to Country Lite» или GeoLite2 Country).
// Адрес никуда не отправляется и не сохраняется.
package geo

import (
	"net"
	"net/netip"

	"github.com/oschwald/maxminddb-golang"
)

// Lookup — страна по IP: двухбуквенный код ISO или пустая строка.
type Lookup interface {
	Country(ip netip.Addr) string
}

// None — база не подключена: страна всегда неизвестна.
type None struct{}

func (None) Country(netip.Addr) string { return "" }

// DB — открытая база стран.
type DB struct {
	r *maxminddb.Reader
}

// Open открывает файл .mmdb.
func Open(path string) (*DB, error) {
	r, err := maxminddb.Open(path)
	if err != nil {
		return nil, err
	}
	return &DB{r: r}, nil
}

func (d *DB) Close() error { return d.r.Close() }

func (d *DB) Country(ip netip.Addr) string {
	var rec struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
	}
	if err := d.r.Lookup(net.IP(ip.AsSlice()), &rec); err != nil {
		return ""
	}
	return rec.Country.ISOCode
}
