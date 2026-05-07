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
Napi::Object InitTransport(Napi::Env env, Napi::Object exports);
void RegisterTCPClient(Napi::Env env, Napi::Object exports);

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
