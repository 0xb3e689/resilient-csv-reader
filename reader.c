#include <stddef.h>
#include <stdint.h>
#include <wasm_simd128.h>

typedef uint8_t Byte;

typedef struct {
    Byte *at;
    Byte *limit;
    int overflow;
} Writer;

static unsigned error_bytes;

// Freestanding WebAssembly needs its own variable-width copy.
void *memcpy(void *dst, const void *src, size_t len) {
    Byte *out = dst;
    const Byte *in = src;
    for (; len >= 16; len -= 16, out += 16, in += 16) {
        wasm_v128_store(out, wasm_v128_load(in));
    }
    for (; len; --len) *out++ = *in++;
    return dst;
}

static inline void append(Writer *w, const void *src, size_t len) {
    if (len > (size_t)(w->limit - w->at)) {
        w->overflow = 1;
        return;
    }
    __builtin_memcpy(w->at, src, len);
    w->at += len;
}

#define literal(w, s) append((w), (s), sizeof(s) - 1)

static void number(Writer *w, unsigned n) {
    Byte digits[10];
    unsigned pos = sizeof(digits);
    do {
        digits[--pos] = '0' + n % 10;
        n /= 10;
    } while (n);
    append(w, digits + pos, sizeof(digits) - pos);
}

static void error_prefix(Writer *w, unsigned *count, const Byte *code,
                         unsigned size, unsigned line, int row) {
    if ((*count)++) literal(w, ",");
    literal(w, "{\"code\":\"");
    append(w, code, size);
    literal(w, "\",\"line\":");
    number(w, line);
    literal(w, ",\"row\":");
    if (row < 0) literal(w, "null");
    else number(w, (unsigned)row);
}

#define ERROR(w, count, code, line, row) \
    error_prefix((w), (count), (const Byte *)(code), sizeof(code) - 1, (line), (row))

static void escape_byte(Writer *w, Byte ch) {
    switch (ch) {
        case '"': literal(w, "\\\""); break;
        case '\\': literal(w, "\\\\"); break;
        case '\t': literal(w, "\\t"); break;
        case '\n': literal(w, "\\n"); break;
        case '\b': literal(w, "\\b"); break;
        case '\f': literal(w, "\\f"); break;
        default: {
            const char hex[] = "0123456789abcdef";
            const char code[] = {'\\', 'u', '0', '0', hex[ch >> 4], hex[ch & 15]};
            append(w, code, sizeof(code));
        }
    }
}

// The caller reserves 16 bytes past the input so a final SIMD load is safe.
static inline const Byte *ordinary(const Byte *p, const Byte *end, int unquoted) {
    while (p < end) {
        const v128_t data = wasm_v128_load(p);
        v128_t special = wasm_v128_or(wasm_u8x16_lt(data, wasm_i8x16_splat(32)),
            wasm_v128_or(wasm_i8x16_eq(data, wasm_i8x16_splat('"')),
                         wasm_i8x16_eq(data, wasm_i8x16_splat('\\'))));
        if (unquoted) special = wasm_v128_or(special, wasm_i8x16_eq(data, wasm_i8x16_splat(',')));
        const unsigned mask = wasm_i8x16_bitmask(special);
        if (mask) {
            const Byte *next = p + __builtin_ctz(mask);
            return next < end ? next : end;
        }
        p += 16;
    }
    return end;
}

static const Byte *closing_quote(const Byte *p, const Byte *end) {
    while (p < end) {
        const unsigned mask = wasm_i8x16_bitmask(
            wasm_i8x16_eq(wasm_v128_load(p), wasm_i8x16_splat('"')));
        if (!mask) {
            p += 16;
            continue;
        }
        p += __builtin_ctz(mask);
        if (p >= end) break;
        if (p + 1 == end || p[1] != '"') return p;
        p += 2;
    }
    return end;
}

static void quoted_text(Writer *w, const Byte *p, const Byte *quote, unsigned *line) {
    while (p < quote) {
        const Byte *next = ordinary(p, quote, 0);
        append(w, p, (size_t)(next - p));
        p = next;
        if (p == quote) break;
        const Byte ch = *p++;
        if (ch == '"') ++p;
        if (ch == '\r' || ch == '\n') {
            if (ch == '\r' && p < quote && *p == '\n') ++p;
            ++*line;
            literal(w, "\\n");
        } else {
            escape_byte(w, ch);
        }
    }
}

unsigned parse(const Byte *p, unsigned len, int header, Byte *data, unsigned data_cap,
               Byte *errors, unsigned error_cap) {
    const Byte *end = p + len;
    Writer out = {data, data + data_cap, 0};
    Writer err = {errors, errors + error_cap, 0};
    unsigned line = 1, width = 0, error_count = 0;
    int row = header ? -1 : 0;

    if (len >= 3 && p[0] == 0xef && p[1] == 0xbb && p[2] == 0xbf) p += 3;
    if (header) literal(&out, "{\"columns\":");
    else literal(&out, "{\"columns\":null,\"rows\":[");
    literal(&err, ",\"errors\":[");

    while (p < end) {
        if (*p == '\n' || (*p == '\r' && p + 1 < end && p[1] == '\n')) {
            p += *p == '\r' ? 2 : 1;
            ++line;
            continue;
        }
        const unsigned record_line = line;
        Byte *record = out.at;
        Byte *extra = NULL;
        unsigned fields = 0;
        int has_value = 0;
        int more;
        if (row > 0) literal(&out, ",");
        literal(&out, "[");

        do {
            if (width && fields == width) extra = out.at;
            if (fields++) literal(&out, ",");
            literal(&out, "\"");
            int closed = 0, kept = 0;
            if (p < end && *p == '"') {
                has_value = 1;
                const Byte *quote = closing_quote(p + 1, end);
                if (quote == end) {
                    ERROR(&err, &error_count, "unterminated_quote", record_line, row);
                    literal(&err, "}");
                } else {
                    quoted_text(&out, p + 1, quote, &line);
                    p = quote + 1;
                    closed = 1;
                }
            }

            while (p < end) {
                const Byte *next = ordinary(p, end, 1);
                if (next != p) {
                    append(&out, p, (size_t)(next - p));
                    kept = 1;
                    p = next;
                }
                if (p == end || *p == ',' || *p == '\n') break;
                if (*p == '\r') {
                    if (p + 1 < end && p[1] == '\n') break;
                    ERROR(&err, &error_count, "stray_cr", record_line, row);
                    literal(&err, "}");
                    ++p;
                } else {
                    escape_byte(&out, *p++);
                    kept = 1;
                }
            }
            if (closed && kept) {
                ERROR(&err, &error_count, "quote_junk", record_line, row);
                literal(&err, "}");
            }
            has_value |= kept;
            literal(&out, "\"");
            if (out.overflow || err.overflow) return 0;

            more = p < end && *p == ',';
            if (more) ++p;
            else if (p < end) {
                p += *p == '\r' ? 2 : 1;
                ++line;
            }
        } while (more);

        if (fields == 1 && !has_value) {
            out.at = record;
            continue;
        }
        if (!width) width = fields;
        if (fields < width) {
            ERROR(&err, &error_count, "short_row", record_line, row);
            literal(&err, ",\"fields\":");
            number(&err, fields);
            literal(&err, "}");
            for (; fields < width && !out.overflow; ++fields) literal(&out, ",\"\"");
        } else if (extra) {
            ERROR(&err, &error_count, "long_row", record_line, row);
            literal(&err, ",\"extra\":[");
            append(&err, extra + 1, (size_t)(out.at - extra - 1));
            literal(&err, "]}");
            out.at = extra;
        }
        literal(&out, "]");
        if (row++ < 0) literal(&out, ",\"rows\":[");
        if (out.overflow || err.overflow) return 0;
    }

    if (row < 0) literal(&out, "[],\"rows\":[");
    literal(&out, "]");
    literal(&err, "]}");
    if (out.overflow || err.overflow) return 0;
    error_bytes = (unsigned)(err.at - errors);
    return (unsigned)(out.at - data);
}

unsigned errors_size(void) { return error_bytes; }
