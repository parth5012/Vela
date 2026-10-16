# Shizuku user service is instantiated by NAME via reflection from the Shizuku
# server (Class.forName on a string), so R8 can never see these references.
-keep class com.vela.client.deviceagent.ShizukuOpsService { *; }
-keep class com.vela.client.deviceagent.IShizukuOps { *; }
-keep class com.vela.client.deviceagent.IShizukuOps$Stub { *; }
