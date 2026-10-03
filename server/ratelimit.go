package main

import (
	"sync"
	"time"
)

// limiter — ограничение частоты запросов к API: «ведро токенов» на каждый ключ.
// Ключ — хэш адреса, а не сам адрес; старые вёдра периодически выбрасываются.
type limiter struct {
	mu      sync.Mutex
	rate    float64 // токенов в секунду
	burst   float64
	buckets map[string]*bucket
	lastGC  time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newLimiter(perMinute, burst int) *limiter {
	return &limiter{rate: float64(perMinute) / 60, burst: float64(burst), buckets: map[string]*bucket{}}
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastGC) > 10*time.Minute {
		for k, b := range l.buckets {
			if now.Sub(b.last) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
		l.lastGC = now
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
