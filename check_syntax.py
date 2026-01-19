content = open('index.html', encoding='utf-8').read()
script_start = content.find('<script>') + len('<script>')
script_end = content.find('</script>', script_start)
script = content[script_start:script_end]

stack = []
for i, char in enumerate(script):
    if char == '(':
        stack.append(('(', i))
    elif char == ')':
        if not stack or stack[-1][0] != '(':
            print(f"Unmatched ) at position {i}: {script[max(0, i-20):i+20]}")
        else:
            stack.pop()
    elif char == '{':
        stack.append(('{', i))
    elif char == '}':
        if not stack or stack[-1][0] != '{':
            print(f"Unmatched }} at position {i}: {script[max(0, i-20):i+20]}")
        else:
            stack.pop()

for char, pos in stack:
    print(f"Unmatched {char} at position {pos}: {script[max(0, pos-20):pos+20]}")
