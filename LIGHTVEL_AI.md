# LIGHTVEL_AI.md — AI Agent Reference Guide (Latest)

> This file is for AI assistants and agentic coding workflows.
> Share this with any coding AI before asking it to build a Lightvel page.
> It contains architecture rules, directive behavior, patterns, and anti-patterns.

---

## 1) What Lightvel Is

Lightvel is a reactive Laravel package where a single Blade file contains:
- Component class (PHP logic)
- UI template (HTML + directives)

No npm, no build step, no SPA framework required.

Execution model:
1. Initial GET renders full HTML.
2. User actions send AJAX JSON requests.
3. Server returns changed state (and optionally `__patch`).
4. Runtime updates bound DOM parts client-side.

---

## 2) Required Project Contract

### 2.1 Layout requirements

Your layout must include:
- CSRF meta
- `@lightScripts` before `</body>`

```blade
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ $title ?? 'App' }}</title>
</head>
<body>
    {!! $slot !!}
    @lightScripts
</body>
</html>
```

Without `@lightScripts`, directives stay static and no runtime reactivity works.

### 2.2 Route registration

```php
// routes/web.php
Route::lightvel('/users', 'pages.users');
Route::lightvel('/product/{id}', 'pages.product');
```

---

## 3) Canonical File Structure

```text
resources/views/
├── layouts/
│   └── app.blade.php
└── pages/
    └── users.blade.php

routes/web.php
config/lightvel.php
```

---

## 4) Canonical Component Template

```blade
@php
use Lightvel\Component;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {
    public function lightvel(): array
    {
        return [
            'users' => \App\Models\User::latest()->paginate(10),
            'search' => '',
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'message' => '',
        ];
    }

    public function searchUsers(Request $request): array
    {
        $search = (string) $request->input('search', '');
        $page = max(1, (int) $request->input('page', 1));

        $q = \App\Models\User::query()->latest();
        if ($search !== '') {
            $q->where(function ($b) use ($search) {
                $b->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }

        return ['users' => $q->paginate(10, ['*'], 'page', $page)];
    }

    public function saveUser(Request $request): array
    {
        $data = $request->validate([
            'name' => 'required|min:3',
            'email' => 'required|email',
        ]);

        $user = \App\Models\User::create($data);

        return [
            'showModal' => false,
            'name' => '',
            'email' => '',
            'message' => 'Saved',
            ...patch()->insert('users', $user),
        ];
    }
};
@endphp
```

---

## 5) Critical Latest Semantics

### 5.1 `light:model.live` (changed)

`light:model.live` does not auto-submit nearest form anymore.

Rules:
1. It always syncs state like `light:model`.
2. It triggers a server action only when value is an explicit action name.
3. If value equals field name / invalid / not action intent, no live action call is made.
4. Manual submit still controls full form submit + validation workflow.

Correct usage:

```blade
<form light:submit="saveUser">
    <input light:model="email" light:model.live="email" />
    <button type="submit">Save</button>
</form>

<input light:model="search" light:model.live="searchUsers" light:debounce="300" />
```

### 5.2 `light:cloak` (changed)

- Base `light:cloak` is boot-only (first page load).
- For action-time skeletons, use `light:cloak.target="actionName"`.

```blade
<div light:cloak>Boot loader...</div>

<div light:cloak light:cloak.target="searchUsers" light:cloak.remove>
  Targeted loader for searchUsers
</div>
```

### 5.3 `light:navigate` runtime

Navigation uses prefetch + cache + in-flight dedupe and shows progress bar.
It is SPA-style DOM swap behavior, not a full browser reload.

---

## 6) Full Directive Reference

### Data binding

| Directive | Purpose | Example |
|---|---|---|
| `light:model="key"` | Two-way input state sync | `<input light:model="name" />` |
| `light:model.live="actionName"` | Model sync + explicit live action | `<input light:model="search" light:model.live="searchUsers" />` |
| `light:debounce="300"` | Delay action calls | `<input light:debounce="300" />` |

### Server actions

| Directive | Purpose | Example |
|---|---|---|
| `light:click="method(args)"` | Call server action | `<button light:click="deleteUser(user.id)">` |
| `light:submit="method"` | Form submit action | `<form light:submit="saveUser">` |
| `light:input="method"` | Input-driven action | `<input light:input="searchUsers">` |
| `light:change="method"` | Change-driven action | `<select light:change="loadFilter">` |

### Client-only action

| Directive | Purpose | Example |
|---|---|---|
| `light:function="expr"` | Instant state updates (no server) | `<button light:function="showModal=true">` |

### Conditional / attributes

| Directive | Purpose | Example |
|---|---|---|
| `light:if="expr"` | Conditional show/hide | `<div light:if="showModal">` |
| `light:show="expr"` | Alias of conditional display | `<div light:show="isLoading">` |
| `light:class="obj"` | Dynamic class toggling | `<div light:class="{'ring': active}">` |
| `light:attr.NAME="expr"` | Reactive attribute binding | `<button light:attr.disabled="isSaving">` |

### Lists

| Directive | Purpose | Example |
|---|---|---|
| `light:for="item in items"` | Loop render | `<tr light:for="user in users">` |

Inside loop context:
- `item.*`
- `$index`

### Output

| Directive | Purpose | Example |
|---|---|---|
| `light:text="expr"` | Text binding | `<span light:text="user.name">` |
| `light:bind="key"` | Alias of text | `<span light:bind="message">` |
| `light:html="key"` | Raw HTML bind | `<div light:html="rich_html">` |
| `light:src="expr"` | Reactive src | `<img light:src="avatar_url">` |
| `{{ light.key }}` | Reactive variable print | `{{ light.name }}` |
| `{{ light("expr") }}` | Reactive expression print | `{{ light("name ? name : 'na'") }}` |

Note: Prefer quoted expression form to avoid PHP analyzer constant warnings.

### Validation

| Directive | Purpose | Example |
|---|---|---|
| `light:rules="..."` | Client-side rules | `<input light:rules="required|email">` |
| `light:error="field"` | Error display | `<span light:error="email"></span>` |
| `light:error-message="msg"` | Override error text | `<span light:error-message="Invalid email"></span>` |

### Loading and skeleton

| Directive | Purpose | Example |
|---|---|---|
| `light:loading` | Show while request active | `<span light:loading>Loading...</span>` |
| `light:loading.target="action"` | Action-scoped loading | `<span light:loading.target="saveUser">` |
| `light:loading.delay="ms"` | Delay loading visibility | `<span light:loading.delay="300">` |
| `light:loading.min="ms"` | Minimum visible time | `<span light:loading.min="800">` |
| `light:loading.remove` | Hide counterpart during loading | `<span light:loading.remove>Save</span>` |
| `light:cloak` | Boot-only skeleton | `<div light:cloak></div>` |
| `light:cloak.target="action"` | Action-time skeleton | `<div light:cloak light:cloak.target="searchUsers">` |
| `light:cloak.repeat="N"` | Repeat skeleton block | `<div light:cloak.repeat="6">` |
| `light:cloak.remove` | Hide real content while cloak active | `<div light:cloak.remove>` |

### Navigation / pagination

| Directive | Purpose | Example |
|---|---|---|
| `light:navigate` | SPA route navigation | `<a href="/users" light:navigate>Users</a>` |
| `light:paginate="users"` | Enable paginator UI | `<div light:paginate="users">` |
| `light:paginate-action="searchUsers"` | Pagination action | `<div light:paginate-action="searchUsers">` |
| `light:paginate-custom` | Use custom pagination markup | `<div light:paginate-custom>` |

### Array / JSON utilities

| Directive | Purpose | Example |
|---|---|---|
| `light:array="key"` | Ensure array state | `<div light:array="selected_ids">` |
| `light:array.add="arr, val"` | Toggle membership | `<input light:array.add="selected_ids, Number(user.id)">` |
| `light:array.check="arr, val"` | Membership check | `<input light:array.check="selected_ids, Number(user.id)">` |
| `light:array.all="arr, list, idKey"` | Fill all values | `<button light:array.all="selected_ids, users, id">` |
| `light:json.add="path, value"` | Push JSON item | `<button light:json.add="subjects_json, {name:'', max:100}">` |
| `light:json.remove="path, target, mode"` | Remove JSON item | `<button light:json.remove="subjects_json, $index, 'index'">` |
| `light:json.check="path, yes, no"` | Dot-path existence check | `<span light:json.check="'profile.city', 'SET', 'MISS'">` |

---

## 7) Patch API (Recommended for CRUD)

Always prefer patch operations for list mutation responses:

```php
return [...patch()->insert('users', $user)];
return [...patch()->update('users', $user)];
return [...patch()->delete('users', $id)];
```

For paginated resources, patch avoids heavy full-list resend and keeps UI fast.

---

## 8) Agent Rules (Must Follow)

1. Use `light:function` for UI-only transitions (modals, local toggles, tabs).
2. Use server actions only for DB/network work.
3. Keep `lightvel()` payload minimal.
4. Ensure template-used keys are present in `lightvel()` initial state.
5. Mirror core defaults in `light:state` when appropriate.
6. Use `patch()` for CRUD list updates.
7. Use `light:model` with `light:model.live`; do not rely on live alone.
8. Never assume `light:model.live` submits parent form.
9. For action skeletons, always add `light:cloak.target`.
10. Keep layout contract (`@lightScripts` + CSRF meta).

---

## 9) Common Mistakes

- Expecting `light:model.live="field"` to auto-submit form.
- Returning complete large collections after every small mutation.
- Using `light:click` for simple modal open/close.
- Forgetting `light:paginate-action` when using default paginator UI.
- Expecting `light:cloak` to trigger on every action without target.
- Using unquoted `{{ light(condition ? 'A' : 'B') }}` in strict analyzers.

Preferred form:

```blade
{{ light("condition ? 'A' : 'B'") }}
```

---

## 10) Patterns for Agentic Generation

### A) Live search (recommended)

```blade
<input light:model="search" light:model.live="searchUsers" light:debounce="300" />
```

### B) Manual form submit + model.live field-only

```blade
<form light:submit="saveUser">
  <input light:model="email" light:model.live="email" />
  <button type="submit">Save</button>
</form>
```

### C) CRUD delete with row-level loader

```blade
<button light:click="deleteUser(user.id)">
  <span light:loading light:loading.target="deleteUser(user.id)">Deleting...</span>
  <span light:loading.remove>Delete</span>
</button>
```

### D) Boot skeleton + real content

```blade
<div light:cloak class="space-y-2">
  <div class="h-4 rounded bg-gray-200"></div>
  <div class="h-4 rounded bg-gray-200"></div>
</div>

<div light:cloak.remove>
  <div light:for="item in items"><span light:text="item.name"></span></div>
</div>
```

---

## 11) Quick Build Checklist for AI

- Route added with `Route::lightvel(...)`
- Layout has CSRF + `@lightScripts`
- Component state keys complete
- Action methods return array payloads
- Validation in action methods when required
- Patch operations for array list updates
- Loading/skeleton UX in long actions
- Pagination wired (`light:paginate` + action)
- Readable messages (`message`, `status`) for UX feedback

---

When ambiguity occurs, follow this file and prefer minimal, predictable behavior over hidden automation.
