<p align="center">
  <h1 align="center">⚡ Lightvel</h1>
  <p align="center">
    <strong>Lightweight Reactive Framework for Laravel</strong><br>
    Build React-like interactive UIs using just Blade — no npm, no build step, no JavaScript writing required.
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/Laravel-11%20%7C%2012%20%7C%2013-red" alt="Laravel">
    <img src="https://img.shields.io/badge/PHP-8.2%2B-blue" alt="PHP">
    <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
    <img src="https://img.shields.io/badge/Version-1.3.76-purple" alt="Version">
  </p>
</p>

---

## What is Lightvel?

Lightvel lets you build **fully reactive, single-page experiences** inside standard Laravel Blade files. Define your component class, your actions, and your template — all in **one file**. No JavaScript frameworks. No build tools. No npm.

**How it compares:**

| Feature | Lightvel | Livewire | Inertia + React |
|---------|----------|----------|-----------------|
| Build step required | ❌ No | ❌ No | ✅ Yes |
| npm required | ❌ No | ❌ No | ✅ Yes |
| Server response | JSON (arrays only) | HTML diff | JSON |
| Client-side actions | ✅ `light:function` | ❌ No | ✅ Yes |
| One-file components | ✅ Yes | ❌ Separate class | ❌ Separate files |
| Patch operations | ✅ Built-in | ❌ No | Manual |
| Learning curve | Low | Medium | High |

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Component Lifecycle](#component-lifecycle)
- [Directives Reference](#directives-reference)
  - [Data Binding](#data-binding)
  - [Actions](#actions)
  - [Client-Side Functions](#client-side-functions)
  - [Conditional Rendering](#conditional-rendering)
  - [List Rendering](#list-rendering)
  - [Text & HTML Binding](#text--html-binding)
  - [Validation](#validation)
  - [SPA Navigation](#spa-navigation)
  - [State Management](#state-management)
- [Patch Operations](#patch-operations)
- [Loading Indicators](#loading-indicators)
- [Initial Page Loader](#initial-page-loader-lightcloak)
- [Pagination](#pagination)
- [Dynamic Route Parameters](#dynamic-route-parameters)
- [Layouts](#layouts)
- [Configuration](#configuration)
- [Artisan Commands](#artisan-commands)
- [Full CRUD Example](#full-crud-example)
- [Performance Tips](#performance-tips)
- [API Reference](#api-reference)

---

## Installation

```bash
composer require lightvel/lightvel
```

Lightvel auto-registers via Laravel's package discovery. No manual provider registration needed.

**Publish config (optional):**

```bash
php artisan vendor:publish --tag=lightvel-config
```

**Add the runtime to your layout** (`resources/views/layouts/app.blade.php`):

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>My App</title>
</head>
<body>
    {!! $slot !!}

    {{-- Lightvel JS runtime — must be before </body> --}}
    @lightScripts
</body>
</html>
```

> **Important:** The `@lightScripts` directive outputs the entire runtime inline. Place it just before `</body>`.

---

## Quick Start

**1. Create a page:**

```bash
php artisan lightvel:make counter
```

This creates `resources/views/pages/counter.blade.php`.

**2. Add a route** (`routes/web.php`):

```php
Route::lightvel('/counter', 'pages.counter');
```

**3. Write your component:**

```blade
@php
use Lightvel\Component;

new #[Layout('app')] class extends Component {
    public function lightvel(): array
    {
        return ['count' => 0];
    }

    public function increment(): array
    {
        return ['count' => request()->input('count', 0) + 1];
    }
};
@endphp

<div light:state="count=0">
    <h1>Count: <span light:text="count"></span></h1>
    <button light:click="increment">+1</button>
</div>
```

**4. Visit** `/counter` — click the button and watch the counter update reactively.

---

## Component Lifecycle

Every Lightvel page is a **single Blade file** containing both the PHP component class and the HTML template.

```
┌─────────────────────────────────────────────────────┐
│                   Blade File                        │
│                                                     │
│  @php                                               │
│    new #[Layout('app')] class extends Component {   │
│      lightvel()  → initial state (runs on GET only) │
│      myAction()  → called via AJAX                  │
│    };                                               │
│  @endphp                                            │
│                                                     │
│  <div light:state="...">                            │
│    ... your HTML with light:* directives ...        │
│  </div>                                             │
└─────────────────────────────────────────────────────┘
```

### How it works:

1. **Initial page load (GET):** `lightvel()` runs → state is serialized into `data-light-*` HTML attributes → full HTML page is rendered
2. **User action (click/submit):** JS sends AJAX POST → `Component::run()` invokes the action method → **only JSON is returned** (no HTML re-render) → JS updates the DOM

> **Key insight:** After the initial load, `lightvel()` is **never called again**. Actions run independently, which is why Lightvel is fast — no DB query re-execution on every action.

---

## Directives Reference

### Data Binding

#### `light:model`

Two-way data binding for form inputs. Syncs the input value with client-side state.

```html
<input type="text" light:model="name" />
<input type="email" light:model="email" />
<textarea light:model="bio"></textarea>
<select light:model="role">
    <option value="admin">Admin</option>
    <option value="user">User</option>
</select>
<input type="checkbox" light:model="active" value="1" />
<input type="radio" light:model="gender" value="male" />
```

#### `light:model.live`

Supports two modes:

1. `light:model.live="fieldName"` — updates state and triggers nearest parent form `light:submit` action.
2. `light:model.live="actionName"` — updates state and directly calls that action (form not required).

Both modes debounce using `light:debounce` when provided.

```html
<form light:submit="searchUsers">
    <input
        type="text"
        light:model.live="search"
        light:debounce="300"
        placeholder="Search..."
    />
</form>

<input
    type="text"
    light:model.live="searchUsers"
    light:model="search"
    light:debounce="300"
    placeholder="Search without form"
/>
```

---

### Actions

#### `light:click`

Triggers a **server-side** action on click. Sends current state and receives updated state.

```html
<!-- Simple action (sends all model values) -->
<button light:click="refresh">Refresh</button>

<!-- Action with arguments -->
<button light:click="deleteUser(5)">Delete</button>

<!-- Inside light:for, use item properties -->
<button light:click="deleteUser(user.id)">Delete</button>
```

Even when action arguments are passed, current `light:model` state is also hydrated into `Request`, so inside action methods you can directly use `$request->fieldName` and `$request->validate([...])`.

#### `light:submit`

Triggers a **server-side** action on form submit. Collects all form inputs + `light:model` values.

```html
<form light:submit="saveUser">
    <input light:model="name" />
    <input light:model="email" />
    <button type="submit">Save</button>
</form>
```

The action receives all form data via `Request`:

```php
public function saveUser(Request $request): array
{
    $name = $request->input('name');
    $email = $request->input('email');
    // ... save to DB
    return ['message' => 'Saved!'];
}
```

---

### Client-Side Functions

#### `light:function`

Updates state **instantly on the client** — **no server call**. This is the key to React-like speed.

```html
<!-- Toggle a modal (instant) -->
<button light:function="showModal=true">Open</button>
<button light:function="showModal=false">Close</button>

<!-- Set multiple values at once -->
<button light:function="showModal=true, editingId=null, name='', email=''">
    New User
</button>

<!-- Pre-fill form with item data (inside light:for) -->
<button light:function="showModal=true, editingId=user.id, name=user.name, email=user.email">
    Edit
</button>
```

> **Performance tip:** Use `light:function` for UI-only changes (modals, tabs, toggles). Reserve `light:click` for server operations (DB queries, saves).

---

### Conditional Rendering

#### `light:if`

Show/hide an element based on a state expression. Hidden during boot (no FOUC).

```html
<div light:if="showModal">...</div>
<div light:if="users.length > 0">Found users!</div>
<div light:if="!showModal">Modal is closed</div>
<span light:if="editingId">Edit Mode</span>
<span light:if="!editingId">Create Mode</span>
```

#### `light:show`

Same as `light:if` — show/hide based on expression.

```html
<div light:show="isLoading">Loading...</div>
```

#### `light:class`

Conditionally add/remove CSS classes.

```html
<div light:class="{'bg-red-500': hasError, 'bg-green-500': !hasError}">
    Status
</div>
```

---

### List Rendering

#### `light:for`

Render a list of items from a state array. Works with both regular elements and `<template>`.

```html
<!-- Table rows -->
<tr light:for="user in users">
    <td light:text="user.name"></td>
    <td light:text="user.email"></td>
    <td>
        <button light:click="deleteUser(user.id)">Delete</button>
    </td>
</tr>

<!-- Divs -->
<div light:for="item in items" class="card">
    <h3 light:text="item.title"></h3>
    <p light:text="item.description"></p>
</div>

<!-- Template tag (renders children only, no wrapper element) -->
<template light:for="tag in tags">
    <span class="badge" light:text="tag.name"></span>
</template>
```

**Available variables inside `light:for`:**

| Variable | Description |
|----------|-------------|
| `user` (or your item name) | Current item object |
| `user.id`, `user.name` etc. | Item properties |
| `$index` | Zero-based index |
| `index` | Same as `$index` |

---

### Text & HTML Binding

#### `light:text`

Bind reactive text content to a state value. Updates automatically when state changes.

```html
<span light:text="message"></span>
<span light:text="count"></span>

<!-- Works with nested properties -->
<span light:text="user.name"></span>
```

#### `{{ light(...) }}` reactive expressions

Use Lightvel expressions with ternary/if-style logic and get automatic live sync.

```html
<!-- Reactive conditional print -->
<p>{{ light(name ? name : 'na') }}</p>

<!-- Nested checks -->
<span>{{ light(user && user.email ? user.email : 'No email') }}</span>

<!-- Works inside repeated templates too -->
<li>{{ light(item.active ? item.name : 'Inactive') }}</li>
```

`{{ light.variableName }}` also still works and remains reactive.

#### `light:attr.*` (reactive attributes)

Bind any HTML attribute using expression logic.

```html
<!-- Dynamic class string -->
<button
    class="px-4 py-2 rounded"
    light:attr.class="isActive ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'"
>
    Save
</button>

<!-- Boolean attributes -->
<button light:attr.disabled="isSaving || !name">Submit</button>
<div light:attr.hidden="!showPanel">Panel</div>

<!-- Any attribute -->
<input light:attr.placeholder="name ? 'Edit user' : 'Enter name'" />
```

If you only need class toggling object style, `light:class` continues to work as before.

#### `light:bind`

Alias for `light:text` — binds `innerText` to a state key via the JS API.

```html
<span light:bind="status"></span>
```

#### `light:src`

Bind the `src` attribute for images, iframes, and similar media elements.

```html
<img light:src="logo_url" alt="Logo" />
<iframe light:src="pdf_url"></iframe>
```

#### `light:html`

Bind raw HTML content (use with caution — no XSS sanitization).

```html
<div light:html="richContent"></div>
```

#### Mustache syntax

You can use both variable and expression forms:

```html
<p>Hello, {{ light.name }}!</p>
<p>Status: {{ light(isOnline ? 'Online' : 'Offline') }}</p>
```

This compiles to reactive text bindings and updates automatically when state changes.

---

### Validation

#### `light:rules`

Client-side validation rules (same syntax as Laravel). Validates before sending to server.

```html
<input light:model="name" light:rules="required|min:3|max:100" />
<input light:model="email" light:rules="required|email" />
<input light:model="age" light:rules="required|numeric|min:18" />
```

**Supported rules:** `required`, `email`, `numeric`, `min:N`, `max:N`

#### `light:error`

Display validation error messages for a field.

```html
<input light:model="name" light:rules="required|min:3" />
<span light:error="name" class="text-red-600"></span>
```

Shows the first error message for that field (both client-side and server-side errors).

#### `light:error-message`

Custom error message override.

```html
<span light:error="name" light:error-message="Please enter your name"></span>
```

#### Server-side validation

Use Laravel's built-in `$request->validate()` or `$this->validate()`:

```php
public function saveUser(Request $request): array
{
    $validated = $request->validate([
        'name' => 'required|min:3|max:100',
        'email' => 'required|email|unique:users,email',
    ]);

    // If validation fails, errors are automatically sent to the client
    // and displayed in light:error elements
}
```

---

### SPA Navigation

#### `light:navigate`

Navigate between pages without a full page reload. Uses AJAX to fetch the next page and swap content.

```html
<a href="/dashboard" light:navigate>Dashboard</a>
<a href="/users" light:navigate>Users</a>
<a href="/settings" light:navigate>Settings</a>
```

Shows a progress bar at the top during navigation. Supports browser back/forward buttons.

---

### State Management

#### `light:image`

Reusable image upload card with click-to-select behavior and immediate temporary preview.

```blade
<div light:image="logo_preview_url, logo_url" class="group relative aspect-[16/10] cursor-pointer">
    <img light:src="logo_preview_url" alt="Logo" class="h-full w-full object-contain" />
    <input type="file" name="logo" accept=".png,.jpg,.jpeg,.webp" hidden />
</div>
```

- Click the image card to open the file picker.
- The selected file is shown immediately as a temporary preview.
- The preview stays client-side until the form is submitted.
- The second argument is the saved URL fallback used when no temp file is chosen.

### Custom Array & JSON Directives (v1.3.49+)

Lightvel now includes utility directives for fast selection logic and dynamic JSON form arrays.

#### Array utilities

```blade
<div light:array="selected_ids">
    <button light:array.all="selected_ids, users, id">Select All</button>

    <tr light:for="user in users"
        light:array.check="selected_ids, Number(user.id), 'bg-teal-50', 'bg-white'">
        <td>
            <input type="checkbox"
                   light:array.check="selected_ids, Number(user.id)"
                   light:array.add="selected_ids, Number(user.id)" />
        </td>
    </tr>
</div>
```

- `light:array="key"` → ensures array exists in state
- `light:array.add="array, value"` → toggle membership
- `light:array.check="array, value"` → membership check
- `light:array.check="array, value, 'trueClass', 'falseClass'"` → membership + class toggle
- `light:array.all="array, list, idKey"` → bulk select from source list

#### JSON utilities

```blade
<button light:json.add="subjects_json, {name:'', max_marks:100}">+ Add Node</button>

<div light:for="subject in subjects_json">
    <input light:model="subject.name" />
    <input type="number" light:model="subject.max_marks" />
    <button light:json.remove="subjects_json, $index, 'index'">Remove</button>
</div>

<span light:json.check="'profile.meta.city', 'SET', 'MISSING'"></span>
<span light:json.check="'profile.meta.city', 'SET', 'MISSING', 'text-green-600', 'text-red-600'"></span>
```

- `light:json.add="path, value"` → append value/object to JSON array path
- `light:json.remove="path, target, 'index'|'value'"` → remove by index or by value
- `light:json.remove="'a.b.c'"` → delete dot-path key directly
- `light:json.check="path, yesText, noText"` → dot-path existence check
- `light:json.check="path, yesText, noText, trueClass, falseClass"` → existence + text + class toggle

#### File upload preview

- `light:image="previewKey, savedKey"` → click-to-select image card with temporary preview

Use `light:image` for logo/avatar tiles where you want the full area to behave like the picker.

> The runtime submits file inputs as multipart form data automatically when a file is present.

> Tip: For nested validation keys, both formats are supported:
> `subjects_json.0.name` and `subjects_json[0].name`.

#### `light:state`

Initialize client-side state variables. Defined on the root element.

```html
<div light:state="count=0, name='', showModal=false, items=[]">
    ...
</div>
```

Also supports JSON format:

```html
<div light:state='{"count": 0, "name": "", "active": true}'>
    ...
</div>
```

#### `light:const`

Define read-only constants that cannot be modified by `api.set()`.

```html
<div light:const="maxItems=100, apiUrl='/api'">
    ...
</div>
```

---

### Debounce

#### `light:debounce`

Delay action execution. Useful for search inputs to avoid excessive server calls.

```html
<!-- Wait 300ms after last keystroke before sending -->
<input light:model.live="search" light:debounce="300" />

<!-- Supports ms and s units -->
<input light:debounce="500ms" />
<input light:debounce="1s" />
```

---

## Patch Operations

Patch operations let you **surgically modify client-side arrays** without re-fetching the entire list from the server. This is the key to fast CRUD operations.

### `patch()->insert(resource, item)`

Add an item to the beginning of a client-side array:

```php
public function createUser(Request $request): array
{
    $user = User::create($request->validated());

    return [
        'message' => 'User created!',
        ...patch()->insert('users', $user),
    ];
}
```

### `patch()->update(resource, item)`

Update an existing item in a client-side array (matched by `id`):

```php
public function updateUser(Request $request): array
{
    $user = User::find($request->input('id'));
    $user->update($request->validated());

    return [
        'message' => 'User updated!',
        ...patch()->update('users', $user),
    ];
}
```

### `patch()->delete(resource, id)`

Remove an item from a client-side array by ID:

```php
public function deleteUser(int $id): array
{
    User::find($id)?->delete();

    return [
        'message' => 'User deleted!',
        ...patch()->delete('users', $id),
    ];
}
```

> **How it works:** Returns a `__patch` key in the JSON response. The JS runtime reads this and modifies the array in-place, then re-renders `light:for` templates. No full page refresh.

---

## Loading Indicators

Show loading states during AJAX actions. Elements with `light:loading` are **hidden by default** and only appear while an action is running.

### Basic Loading

```html
<button light:click="saveUser">Save</button>
<span light:loading>Saving...</span>
```

### Default Spinner

Lightvel includes a built-in spinner CSS class:

```html
<span light:loading class="lightvel-spinner"></span>
```

### Targeted Loading (`light:loading.target`)

Show a spinner **only when a specific action** is running. Other actions won't trigger it:

```html
<!-- This spinner shows ONLY during saveUser, not during deleteUser or search -->
<span light:loading light:loading.target="saveUser" class="lightvel-spinner"></span>

<!-- This one shows ONLY during deleteUser -->
<span light:loading light:loading.target="deleteUser" class="lightvel-spinner"></span>
```

### Custom Loading Text

Put **any content** inside `light:loading` — text, spinners, icons, anything. It's hidden by default and shown during the action:

```html
<button light:click="saveUser" class="relative">
    <!-- Normal button text -->
    Save User

    <!-- Custom loading content: appears ONLY while saving -->
    <span light:loading light:loading.target="saveUser">
        <span class="lightvel-spinner" style="width:14px;height:14px;"></span>
        Saving...
    </span>
</button>
```

### Delay (avoid flash for fast requests)

Only show the loading indicator if the request takes longer than the delay:

```html
<!-- Show only if request takes > 300ms -->
<span light:loading light:loading.delay="300">Loading...</span>
```

### Minimum Display Time

Keep the loading indicator visible for at least a minimum time:

```html
<!-- Show for at least 2 seconds -->
<div light:loading light:loading.min="2000">
    <div class="lightvel-spinner"></div>
    <p>Processing your request...</p>
</div>
```

### Combined: Delay + Min + Target

```html
<!-- Wait 300ms before showing, show for at least 1s, only during search -->
<span light:loading light:loading.target="searchUsers" light:loading.delay="300" light:loading.min="1000">
    Searching...
</span>
```

### Skeleton Loading (Custom Markup)

Lightvel does not enforce a default skeleton style now. Build your own skeleton markup/classes and show it via `light:boot` or `light:cloak`.

---

## Page-Load Skeleton (`light:boot`)

Use `light:boot` when you want a placeholder visible on first page load.

```html
<div light:boot class="space-y-3">
    <div class="h-4 rounded bg-gray-200"></div>
    <div class="h-4 rounded bg-gray-200"></div>
</div>
```

## Targeted Skeleton (`light:cloak`)

`light:cloak` now behaves as a loading-driven skeleton placeholder.
It is shown only while its loading target is active.

```html
<!-- Show custom skeleton while searchUsers runs -->
<div light:cloak light:cloak.target="searchUsers" class="space-y-3">
    <div class="h-4 rounded bg-gray-200"></div>
    <div class="h-4 rounded bg-gray-200"></div>
    <div class="h-4 rounded bg-gray-200"></div>
</div>

<!-- Repeat same skeleton card 6 times -->
<div light:cloak light:cloak.target="searchUsers" light:cloak.repeat="6" class="rounded-lg border p-4">
    <div class="h-5 w-1/2 rounded bg-gray-200"></div>
    <div class="mt-3 h-4 rounded bg-gray-100"></div>
</div>

<!-- Optional delay/min support (same semantics as light:loading) -->
<div light:cloak light:cloak.target="saveUser" light:cloak.delay="200" light:cloak.min="600">
    <div class="h-10 rounded bg-gray-200"></div>
</div>
```

| Modifier | Purpose |
|----------|---------|
| `light:cloak.target="actionName"` | Show skeleton only for that action |
| `light:cloak.repeat="N"` | Duplicate skeleton block N times |
| `light:cloak.delay="ms"` | Show skeleton only after delay |
| `light:cloak.min="ms"` | Keep skeleton visible for minimum time |

---

## Pagination

Lightvel supports Laravel's `paginate()` with **no page reload**. Just use `paginate(N)` in PHP — the framework handles everything.

### Backend (Minimal Setup)

```php
public function lightvel(): array
{
    // paginate(10) = 10 items per page, page=1 default
    return [
        'users' => User::query()->latest()->paginate(10),
    ];
}

// Action for page changes + search
public function searchUsers(Request $request): array
{
    $page = max(1, (int) $request->input('page', 1));
    $search = (string) $request->input('search', '');

    $query = User::query()->latest();
    if ($search !== '') {
        $query->where('name', 'like', "%{$search}%");
    }

    return [
        'users' => $query->paginate(10, ['*'], 'page', $page),
    ];
}
```

### Frontend (Default Pagination)

Just add two attributes — pagination UI is auto-rendered:

```html
<!-- Table -->
<table>
    <tr light:for="user in users">
        <td light:text="user.name"></td>
    </tr>
</table>

<!-- Auto-rendered Tailwind pagination — NO page reload -->
<div light:paginate="users" light:paginate-action="searchUsers"></div>
```

When a user clicks "Next", Lightvel calls `searchUsers({ page: 2 })` via AJAX and updates the table instantly.

**Defaults (user doesn't need to set these):**
- `page = 1` (default first page)
- `perPage = 10` (from your `paginate(10)` call)
- Responsive: mobile shows Prev/Next, desktop shows full page numbers

### Custom Pagination UI

If you want your **own design**, add `light:paginate-custom` and build your HTML. Use `Lightvel.goToPage('resource', pageNumber)` to navigate:

```html
<div light:paginate="users" light:paginate-action="searchUsers" light:paginate-custom>
    <div class="flex items-center gap-4">
        <!-- Previous button -->
        <button
            type="button"
            light:if="users.current_page > 1"
            onclick="Lightvel.goToPage('users', Lightvel.js.state.users.current_page - 1)"
            class="px-4 py-2 bg-gray-200 rounded"
        >
            ← Prev
        </button>

        <!-- Page info -->
        <span>
            Page <span light:text="users.current_page"></span>
            of <span light:text="users.last_page"></span>
            (<span light:text="users.total"></span> total)
        </span>

        <!-- Next button -->
        <button
            type="button"
            light:if="users.current_page < users.last_page"
            onclick="Lightvel.goToPage('users', Lightvel.js.state.users.current_page + 1)"
            class="px-4 py-2 bg-gray-200 rounded"
        >
            Next →
        </button>
    </div>
</div>
```

**Available paginator state keys:**

| Key | Example | Description |
|-----|---------|-------------|
| `users.current_page` | `1` | Current page number |
| `users.last_page` | `5` | Last page number |
| `users.total` | `48` | Total items count |
| `users.from` | `1` | First item on current page |
| `users.to` | `10` | Last item on current page |
| `users.per_page` | `10` | Items per page |

**JS Helper:**

```javascript
// Navigate to page 3 of the 'users' resource
Lightvel.goToPage('users', 3);

// Access current page in JS
Lightvel.js.state.users.current_page;
```

---

## Dynamic Route Parameters

Pass route parameters directly to your `lightvel()` method:

### Route Definition

```php
// routes/web.php
Route::lightvel('/product/{id}', 'pages.product');
Route::lightvel('/post/{slug}/{tab}', 'pages.post');
```

### Component

Parameters are passed in order to `lightvel()` as arguments:

```blade
@php
use Lightvel\Component;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {
    // $id receives the {id} from the route
    public function lightvel($id): array
    {
        return [
            'product' => Product::findOrFail($id),
        ];
    }

    // Multiple params: lightvel($slug, $tab)
    // ↑ matches Route::lightvel('/post/{slug}/{tab}', ...)
};
@endphp

<div light:state="product={}">
    <h1 light:text="product.name"></h1>
    <p light:text="product.description"></p>
</div>
```

---

## Layouts

Specify a layout using the `#[Layout]` attribute:

```php
// Use layouts/app.blade.php
new #[Layout('app')] class extends Component { ... }

// Use layouts/admin.blade.php
new #[Layout('admin')] class extends Component { ... }

// Pass data to layout
new #[Layout('app', ['title' => 'Dashboard'])] class extends Component { ... }
```

Alternative syntax:

```php
# layout('admin')
new class extends Component { ... }
```

If no layout is specified, the `default_layout` from config is used (default: `app`).

**Layout file** (`resources/views/layouts/app.blade.php`):

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ $title ?? 'My App' }}</title>
</head>
<body>
    {!! $slot !!}
    @lightScripts
</body>
</html>
```

---

## Configuration

Publish config: `php artisan vendor:publish --tag=lightvel-config`

```php
// config/lightvel.php
return [
    // Default layout when none is specified
    'default_layout' => env('LIGHTVEL_LAYOUT', 'app'),

    // Folder where layouts live (relative to views)
    'layout_folder' => 'layouts',

    // Sub-folder for generated pages
    'view_root' => '',

    // Custom JS runtime path (if overriding the built-in)
    'script_path' => env('LIGHTVEL_SCRIPT_PATH'),

    // Progress bar color for light:navigate
    'progress_bar_color' => env('LIGHTVEL_PROGRESS_BAR_COLOR', '#111827'),

    // AJAX endpoint path
    'message_endpoint' => env('LIGHTVEL_MESSAGE_ENDPOINT', '/lightvel/message'),
];
```

---

## Artisan Commands

```bash
# Create a new Lightvel page
php artisan lightvel:make dashboard
# → Creates resources/views/pages/dashboard.blade.php

# Create a layout
php artisan lightvel:layout admin
# → Creates resources/views/layouts/admin.blade.php

# Install Lightvel (publish config + setup)
php artisan lightvel:install
```

`lightvel:make` now generates a clean starter file with only essential state + view structure so you can start immediately without deleting extra sample methods.

Each generated component also includes one random Sanskrit life-wisdom line inside a hidden `div` HTML comment.

---

## Full CRUD Example

See [`example-users-crud-v1.3.49.blade.php`](example-users-crud-v1.3.49.blade.php) for a complete, production-ready showcase with:

- CRUD table + pagination + patch updates
- Form-free live action: `light:model.live="searchUsers"`
- Reactive expression print: `{{ light(name ? name : 'na') }}`
- Reactive attributes: `light:attr.class`, `light:attr.disabled`, `light:attr.hidden`
- Array helpers: `light:array.add`, `light:array.check`
- JSON helpers: `light:json.add`, `light:json.remove`
- Image preview: `light:image` + `light:src`
- Validation + loading + modal + navigation

**Setup for testing:**

```php
// routes/web.php
Route::lightvel('/users', 'pages.users');
```

Copy the example file to `resources/views/pages/users.blade.php`, then visit `/users`.

---

## Performance Tips

### 1. Use `light:function` for UI-only changes

```html
<!-- ✅ FAST: No server call -->
<button light:function="showModal=true">Open</button>

<!-- ❌ SLOW: Unnecessary server round-trip -->
<button light:click="openModal">Open</button>
```

### 2. Use `patch()` instead of returning full arrays

```php
// ✅ FAST: Only modifies the affected item
return [...patch()->update('users', $user)];

// ❌ SLOW: Re-sends the entire users array
return ['users' => User::all()];
```

### 3. Use `light:debounce` for search inputs

```html
<!-- ✅ Waits 300ms between server calls -->
<input light:model.live="search" light:debounce="300" />

<!-- ❌ Fires on every single keystroke -->
<input light:model.live="search" />
```

### 4. Keep `lightvel()` lean

The `lightvel()` method only runs on the initial page load. Keep it fast:

```php
// ✅ Good: Only fetch what you need
return ['users' => User::latest()->limit(10)->get()];

// ❌ Bad: Fetching everything
return ['users' => User::all()];
```

---

## API Reference

### PHP Component Methods

| Method | Description |
|--------|-------------|
| `lightvel(): array` | Define initial state (runs on page load only) |
| `setState(array $data)` | Set state values programmatically |
| `state(?string $key)` | Get a state value |
| `validate($rules)` | Run Laravel validation |
| `validateOnly(string $field)` | Validate a single field |
| `getDeltaState(): array` | Get changed state keys since last snapshot |
| `stateForClient(): array` | Get state formatted for serialization |
| `rulesForClient(): array` | Get validation rules for client |
| `getErrorBag()` | Get the validation error bag |

### JavaScript API

Access via `window.Lightvel.js`:

```javascript
let api = window.Lightvel.js;

// Get/set state
api.get('count');         // Read a value
api.set('count', 5);     // Set a value (triggers re-render)

// Batch updates (single re-render at the end)
api.batch(() => {
    api.set('name', 'John');
    api.set('email', 'john@example.com');
});

// Register a client-side action handler
api.register('myAction', (context) => {
    context.set('count', context.state.count + 1);
});
```

### Global Lightvel Config

```javascript
// Set global debounce delay
window.Lightvel.setDebounceDelay(200);

// Clear response cache
window.Lightvel.clearCache();
```

---

## Requirements

- **PHP** 8.2+
- **Laravel** 11, 12, or 13
- A `<meta name="csrf-token">` tag in your layout

---

## License

MIT License — see [LICENSE](LICENSE) for details.

**Built with ❤️ by [Ankur Jha](https://github.com/ankurjhaaa)**
