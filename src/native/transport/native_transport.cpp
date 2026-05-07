/**
 * native_transport.cpp — Combined module entry point
 *
 * Aggregates both NativeTCPServer and NativeTCPClient into a single
 * NODE_API_MODULE so they share one .node binary and one dlopen() call.
 *
 * Linux-only. On other platforms this file compiles to an empty stub so
 * the build target still exists without errors.
 */

#ifdef __linux__

#include <napi.h>

// Forward declarations from the individual implementation files
void RegisterTCPClient(Napi::Env env, Napi::Object exports);

// NativeTCPServer::Init is defined in tcp_server.cpp — include it directly
// via a shared header so we don't need an extra translation unit.

// ── We re-declare the server Init signature here so it links cleanly ──────
namespace { extern Napi::Object InitTransport(Napi::Env, Napi::Object); }

// The real entry point: initialise both classes on the exports object
Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    // Register server class (NativeTCPServer)
    InitTransport(env, exports);
    // Register client class (NativeTCPClient)
    RegisterTCPClient(env, exports);
    return exports;
}

NODE_API_MODULE(native_transport, InitAll)

#else

// Non-Linux stub — produces a valid but empty .node so require() doesn't throw
#include <napi.h>

Napi::Object InitStub(Napi::Env env, Napi::Object exports) {
    exports.Set("__platform_unsupported__", Napi::Boolean::New(env, true));
    return exports;
}

NODE_API_MODULE(native_transport, InitStub)

#endif // __linux__
