#ifndef NEEDLE_H
#define NEEDLE_H

#ifdef __cplusplus
extern "C" {
#endif

int needle_init(const char* system_prompt, const char* tools_json, const char* tool_index_path);
int needle_complete(const char* input, int max_new_tokens, char* out, int out_capacity);
int needle_reset(void);
int needle_free(void);

#ifdef __cplusplus
}
#endif

#endif // NEEDLE_H
