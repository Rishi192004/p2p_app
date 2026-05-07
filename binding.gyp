{
  "targets": [
    {
      "target_name": "pow",
      "sources": [ "src/native/pow.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      }
    },
    {
      "target_name": "native_transport",
      "conditions": [
        ["OS=='linux'", {
          "sources": [
            "src/native/transport/tcp_server.cpp",
            "src/native/transport/tcp_client.cpp",
            "src/native/transport/native_transport.cpp"
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "dependencies": [
            "<!(node -p \"require('node-addon-api').gyp\")"
          ],
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "cflags": [ "-fexceptions" ],
          "cflags_cc": [ "-fexceptions" ],
          "defines": [ "NAPI_CPP_EXCEPTIONS" ],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1 }
          }
        }],
        ["OS!='linux'", {
          "sources": [
            "src/native/transport/native_transport.cpp"
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "dependencies": [
            "<!(node -p \"require('node-addon-api').gyp\")"
          ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1 }
          }
        }]
      ]
    }
  ]
}
