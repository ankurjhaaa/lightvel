# LIGHTVEL_AI.md — AI Implementation Guide (Latest)

This file is the authoritative reference for AI assistants generating Lightvel code.
It is aligned with the latest runtime/directive behavior.

---

## 1) Core Model

Lightvel is a server-driven reactive layer for Laravel Blade:
- One Blade file contains component class + markup.
- Initial page render returns HTML.
- Interactions return JSON state (and optional `__patch`) over AJAX.
- Runtime updates DOM bindings (`light:text`, `light:for`, etc.) client-side.

No npm/build step is required.

---

## 2) Required Layout Contract

Every layout used by Lightvel pages should include:
- CSRF token meta
- `@lightScripts` before `</body>`

```blade
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="csrf-token" content="{{ csrf_token() }}">
  <title>{{ $title ?? 'App' }}</title>
</head>
<body>
  {!! $slot !!}
  @lightScripts
</body>
</html>
```

Without `@lightScripts`, directives render as static HTML and no reactivity runs.

---

## 3) Component Skeleton

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
            'message' => '',
        ];
    }

    public function searchUsers(Request $request): array
    {
        $search = (string) $request->input('search', '');
        $page = max(1, (int) $request->input('page', 1));

        $query = \App\Models\User::query()->latest();
        if ($search !== '') {
            $query->where('name', 'like', "%{$search}%");
        }

        return ['users' => $query->paginate(10, ['*'], 'page', $page)];
    }
};
@endphp
```

---

## 4) `light:model.live` (Important Latest Behavior)

`light:model.live` no longer auto-submits nearest form.

### Rules

1. It always updates model state (same as `light:model`).
2. It triggers an action **only** if the value is an explicit action name.
3. If value is missing / same as field name / not intended as action, it behaves like plain `light:model`.
4. Manual form submit still controls validation + save actions.

### Correct pattern

```blade
<form light:submit="saveUser">
  <input light:model="email" light:model.live="email" />
  <button type="submit">Save</button>
</form>

<input light:model="search" light:model.live="searchUsers" light:debounce="300" />
```

- First input: no live action call, only model sync.
- Second input: calls `searchUsers` with debounce.

---

## 5) Directive Reference (Practical)

### Data / Output
- `light:model="key"`
- `light:model.live="actionName"`
- `light:text="expr"`
- `light:bind="key"` (alias of text)
- `light:html="key"`
- `light:src="expr"`
- `{{ light.key }}`
- `{{ light("expression") }}` (use string form to avoid PHP analyzer warnings)

### Actions
- `light:click="method(args)"`
- `light:submit="method"`
- `light:change="method(...)"`
- `light:input="method(...)"`
- `light:function="a=1, showModal=true"` (client-only; no server trip)

### Conditional / Attr
- `light:if="expr"`
- `light:show="expr"`
- `light:class="{...}"`
- `light:attr.NAME="expr"`

### Repetition
- `light:for="item in items"`

### Validation
- `light:rules="required|min:3"`
- `light:error="field"`
- `light:error-message="custom text"`

### Loading / Skeleton
- `light:loading`
- `light:loading.target="actionName"`
- `light:loading.delay="300"`
- `light:loading.min="800"`
- `light:loading.remove`

- `light:cloak` => boot-only skeleton (first load)
- `light:cloak.target="actionName"` => action-time skeleton enabled
- `light:cloak.repeat="N"`
- `light:cloak.delay="ms"`
- `light:cloak.min="ms"`
- `light:cloak.remove`

### Navigation / Pagination
- `light:navigate`
- `light:paginate="users"`
- `light:paginate-action="searchUsers"`
- `light:paginate-custom`

### Array / JSON Utilities
- `light:array`, `light:array.add`, `light:array.check`, `light:array.all`
- `light:json.add`, `light:json.remove`, `light:json.check`

---

## 6) Patch Operations (Use by Default for CRUD)

Prefer patch ops to avoid full list refetch:

```php
return [...patch()->insert('users', $user)];
return [...patch()->update('users', $user)];
return [...patch()->delete('users', $id)];
```

Patch keeps UI responsive and avoids replacing entire arrays.

---

## 7) Navigation Behavior (Latest)

`light:navigate` uses SPA-style fetch + DOM swap and includes intent prefetch:
- prefetch on hover/focus/touch
- response cache + in-flight dedupe
- progress bar during navigation

Use `light:function` for immediate UI shell toggles when needed; use `light:navigate` for route transitions.

---

## 8) Performance Rules for AI

1. Use `light:function` for UI-only operations (modal/tabs/open-close).
2. Use `light:click` only when server/data change is required.
3. Debounce live search inputs (`light:debounce="250"` or `300`).
4. Prefer `patch()` for CRUD responses.
5. Keep `lightvel()` initial payload small.
6. Use `light:cloak` + `light:cloak.remove` for first-load UX.
7. For action-time skeletons, always add `light:cloak.target`.

---

## 9) Common Mistakes (Avoid)

- Using `light:model.live="field"` expecting form auto-submit (no longer true).
- Omitting `light:model` with `light:model.live` on the same input.
- Returning full large collections after small CRUD changes instead of `patch()`.
- Using unquoted `{{ light(condition ? 'a' : 'b') }}` in editors that flag PHP constants.
  Prefer: `{{ light("condition ? 'a' : 'b'") }}`.
- Expecting `light:cloak` to run for every action without `light:cloak.target`.

---

## 10) Minimal AI-Generated Page Template

```blade
@php
use Lightvel\Component;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {
    public function lightvel(): array
    {
        return [
            'query' => '',
            'items' => \App\Models\Item::latest()->paginate(10),
        ];
    }

    public function searchItems(Request $request): array
    {
        $query = (string) $request->input('query', '');
        $page = max(1, (int) $request->input('page', 1));

        $q = \App\Models\Item::query()->latest();
        if ($query !== '') {
            $q->where('name', 'like', "%{$query}%");
        }

        return ['items' => $q->paginate(10, ['*'], 'page', $page)];
    }
};
@endphp

<div light:state="query='', items=[]">
    <input light:model="query" light:model.live="searchItems" light:debounce="300" />

    <div light:cloak class="space-y-2">
        <div class="h-4 rounded bg-gray-200"></div>
        <div class="h-4 rounded bg-gray-200"></div>
    </div>

    <div light:cloak.remove>
        <div light:for="item in items">
            <span light:text="item.name"></span>
        </div>
    </div>

    <div light:paginate="items" light:paginate-action="searchItems"></div>
</div>
```

---

If behavior conflicts arise, treat this file as source-of-truth for generated code conventions.
