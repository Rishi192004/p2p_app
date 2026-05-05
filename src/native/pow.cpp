#include <napi.h>
#include <string>
#include <chrono>

/**
 * simple_hash: A very basic, fast hash for demonstration.
 * In a production Google-grade app, you'd use SHA-256 via OpenSSL.
 */
uint32_t simple_hash(const std::string& data) {
    uint32_t hash = 0x811c9dc5;
    for (char c : data) {
        hash ^= (uint32_t)c;
        hash *= 0x01000193;
    }
    return hash;
}

/**
 * SolvePuzzle: Brute-force a nonce that makes the hash divisible by difficulty.
 */
Napi::Value SolvePuzzle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "String and Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string data = info[0].As<Napi::String>().Utf8Value();
    uint32_t difficulty = info[1].As<Napi::Number>().Uint32Value();

    uint32_t nonce = 0;
    while (true) {
        std::string attempt = data + std::to_string(nonce);
        uint32_t hash = simple_hash(attempt);
        
        if (hash % difficulty == 0) {
            return Napi::Number::New(env, nonce);
        }
        nonce++;
        
        // Safety break to prevent infinite loop if difficulty is impossible
        if (nonce > 10000000) break; 
    }
    
    return Napi::Number::New(env, 0);
}

/**
 * VerifyPuzzle: O(1) verification of a solution.
 */
Napi::Value VerifyPuzzle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::string data = info[0].As<Napi::String>().Utf8Value();
    uint32_t difficulty = info[1].As<Napi::Number>().Uint32Value();
    uint32_t nonce = info[2].As<Napi::Number>().Uint32Value();

    std::string attempt = data + std::to_string(nonce);
    uint32_t hash = simple_hash(attempt);
    
    return Napi::Boolean::New(env, (hash % difficulty == 0));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "solvePuzzle"), Napi::Function::New(env, SolvePuzzle));
    exports.Set(Napi::String::New(env, "verifyPuzzle"), Napi::Function::New(env, VerifyPuzzle));
    return exports;
}

NODE_API_MODULE(pow, Init)
