package com.vela.client.deviceagent;

interface IShizukuOps {

    // Destroy method defined by Shizuku server — must stay 16777114 (see
    // Shizuku-API README: "The transaction code for that method is 16777115
    // (use 16777114 in aidl)").
    void destroy() = 16777114;

    // Runs one allowlisted privileged operation. Returns "<exit code>\n<output>".
    String execOp(String op, in String[] args) = 2;
}
