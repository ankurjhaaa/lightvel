# LIGHTVEL_AI.md — AI Agent Reference Guide

> **This file is for AI assistants and agentic coding tools.**
> When a developer asks an AI to build features with Lightvel, share this file as context.
> It contains everything an AI needs to generate correct, optimized Lightvel code.

---

## What is Lightvel?

Lightvel is a reactive Laravel package. You define a component class + HTML template in a **single Blade file**. No npm, no build step, no separate JS files. Everything is Blade + PHP.

---

## File Structure

```
resources/views/
├── layouts/
│   └── app.blade.php          ← Layout with @lightScripts
└── pages/
    └── your-page.blade.php    ← Component file (class + template)

routes/web.php                 ← Route::lightvel('/url', 'pages.your-page');
```

---

## How to Create a Page

### Step 1: Route

```php
// routes/web.php
Route::lightvel('/users', 'pages.users');
```

### Step 2: Blade File

Every Lightvel page has this exact structure:

```blade
@php
use Lightvel\Component;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {

    // INITIAL STATE — runs only on first page load (GET request).
    // Returns an array of key-value pairs that become reactive state.
    // This method is SKIPPED on AJAX action calls for performance.
    public function lightvel(): array
    {
        return [
            'items' => Item::latest()->limit(20)->get(),
            'search' => '',
            'showModal' => false,
            'message' => '',
        ];
    }

    // ACTION METHOD — called via AJAX when user clicks/submits.
    // Receives Request with form data. Returns array to update client state.
    public function saveItem(Request $request): array
    {
        $validated = $request->validate([
            'name' => 'required|min:3',
        ]);

        $item = Item::create($validated);

        return [
            'showModal' => false,
            'message' => 'Item created!',
            ...patch()->insert('items', $item),  // Surgical DOM update
        ];
    }

    public function deleteItem(int $id): array
    {
        Item::find($id)?->delete();

        return [
            'message' => 'Item deleted!',
            ...patch()->delete('items', $id),
        ];
    }
};
@endphp

{{-- HTML template with light:* directives --}}
<div light:state="items=[], search='', showModal=false, message=''">
    <button light:function="showModal=true">New Item</button>
    <span light:text="message"></span>

    <div light:for="item in items">
        <span light:text="item.name"></span>
        <button light:click="deleteItem(item.id)">Delete</button>
    </div>

    <div light:if="showModal">
        <form light:submit="saveItem">
            <input light:model="name" light:rules="required|min:3" />
            <span light:error="name"></span>
            <button type="submit">Save</button>
            <button type="button" light:function="showModal=false">Cancel</button>
        </form>
    </div>
</div>
```

### Step 3: Layout

The layout MUST have `@lightScripts` before `</body>` and a CSRF meta tag:

```html
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

---

## Complete Directive Reference

### Data Binding (two-way)

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:model="key"` | Sync input value with state | `<input light:model="name" />` |
| `light:model.live="key"` | Auto-submit parent form on input | `<input light:model.live="search" light:debounce="300" />` |

### Server Actions (AJAX call to PHP)

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:click="method(args)"` | Call PHP method on click | `<button light:click="delete(item.id)">` |
| `light:submit="method"` | Call PHP method on form submit | `<form light:submit="saveUser">` |

### Client-Side Actions (NO server call — instant)

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:function="key=value"` | Set state instantly on client | `<button light:function="showModal=true">` |

> **CRITICAL FOR AI:** Use `light:function` for UI toggles (modals, tabs, dropdowns). Use `light:click` ONLY when you need the server (DB operations). This is the key to fast UX.

### Conditional Rendering

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:if="expr"` | Show/hide element | `<div light:if="showModal">` |
| `light:show="expr"` | Same as light:if | `<div light:show="isLoading">` |
| `light:class="obj"` | Conditional CSS classes | `<div light:class="{'active': isActive}">` |

### List Rendering

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:for="item in items"` | Loop over array | `<tr light:for="user in users">` |

Inside `light:for`, you can access:
- `item.property` — item fields
- `$index` — zero-based index
- Use `light:text`, `light:click`, `light:function` with item properties

### Text/HTML Output

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:text="expr"` | Bind text content | `<span light:text="user.name">` |
| `light:html="key"` | Bind raw HTML | `<div light:html="content">` |
| `light:bind="key"` | Alias for light:text | `<span light:bind="status">` |
| `{{ light.key }}` | Mustache syntax | `Hello, {{ light.name }}!` |

### Validation

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:rules="rules"` | Client-side validation | `<input light:rules="required\|email">` |
| `light:error="field"` | Show error message | `<span light:error="email">` |

Supported rules: `required`, `email`, `numeric`, `min:N`, `max:N`

### State Initialization

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:state="..."` | Init client state | `<div light:state="count=0, name=''">` |
| `light:const="..."` | Read-only constants | `<div light:const="maxItems=100">` |
| `light:debounce="ms"` | Delay action | `<input light:debounce="300">` |

### Navigation

| Directive | Purpose | Example |
|-----------|---------|---------|
| `light:navigate` | SPA-style link | `<a href="/page" light:navigate>` |

---

## Patch Operations — Surgical Array Updates

**ALWAYS use patch() for CRUD actions.** This avoids re-fetching the entire list.

```php
// INSERT — adds item to beginning of client array
return [...patch()->insert('users', $newUser)];

// UPDATE — merges changes into existing item (matched by id)
return [...patch()->update('users', $updatedUser)];

// DELETE — removes item from client array by id
return [...patch()->delete('users', $id)];
```

You can combine patch with other state updates:

```php
return [
    'showModal' => false,
    'message' => 'User saved!',
    'name' => '',
    'email' => '',
    ...patch()->insert('users', $user),
];
```

---

## Common Patterns for AI

### Pattern 1: CRUD Page

```php
public function lightvel(): array
{
    return [
        'items' => Model::latest()->limit(20)->get(),
        'showModal' => false,
        'editingId' => null,
        'name' => '',
        'message' => '',
    ];
}

public function save(Request $request): array
{
    $id = (int) $request->input('editingId');
    $validated = $request->validate(['name' => 'required']);

    if ($id > 0) {
        $item = Model::find($id);
        $item->update($validated);
        return [
            'showModal' => false, 'editingId' => null, 'name' => '',
            'message' => 'Updated!',
            ...patch()->update('items', $item->fresh()),
        ];
    }

    $item = Model::create($validated);
    return [
        'showModal' => false, 'editingId' => null, 'name' => '',
        'message' => 'Created!',
        ...patch()->insert('items', $item),
    ];
}

public function delete(int $id): array
{
    Model::find($id)?->delete();
    return ['message' => 'Deleted!', ...patch()->delete('items', $id)];
}
```

### Pattern 2: Live Search

```blade
<form light:submit="search">
    <input light:model.live="query" light:debounce="300" placeholder="Search..." />
</form>
```

```php
public function search(Request $request): array
{
    $q = $request->input('query', '');
    $items = Model::where('name', 'like', "%{$q}%")->limit(20)->get();
    return ['items' => $items];
}
```

### Pattern 3: Modal with Form

```blade
{{-- Open button (instant, no server) --}}
<button light:function="showModal=true, editingId=null, name=''">New</button>

{{-- Edit button inside light:for (pre-fills form from item data) --}}
<button light:function="showModal=true, editingId=item.id, name=item.name">Edit</button>

{{-- Modal --}}
<div light:if="showModal">
    <div light:function="showModal=false">{{-- backdrop --}}</div>
    <form light:submit="save">
        <input type="hidden" light:model="editingId" />
        <input light:model="name" light:rules="required" />
        <span light:error="name"></span>
        <button type="submit">Save</button>
        <button type="button" light:function="showModal=false">Cancel</button>
    </form>
</div>
```

### Pattern 4: Status Messages

```blade
<div light:if="message" class="alert">
    <span light:text="message"></span>
</div>
```

Always return `'message' => 'Your message'` from actions.

---

## Rules for AI Code Generation

1. **Always use `light:function` for UI-only changes** (modal open/close, tab switch, form reset). Never use `light:click` for these.

2. **Always use `patch()` for CRUD returns.** Never return the full array from DB.

3. **`lightvel()` must return ALL state keys** that the template uses. If the template has `light:model="name"`, then `lightvel()` must return `'name' => ''`.

4. **`light:state` on the root element must mirror `lightvel()` keys.** This initializes the JS state before server state arrives.

5. **Action methods return arrays.** Keys in the returned array update the corresponding client-side state. Return `(object)[]` or omit return for no-op.

6. **Server validation:** Use `$request->validate()` — errors auto-display in `light:error` elements.

7. **light:for items must have an `id` field** for patch operations to work correctly.

8. **Layout must have `@lightScripts` before `</body>`** and `<meta name="csrf-token">` in `<head>`.

9. **Route format:** `Route::lightvel('/url', 'folder.view-name');`

10. **After creating/modifying Blade files:** Run `php artisan view:clear` to rebuild compiled views.

---

## Artisan Commands

```bash
php artisan lightvel:make page-name      # Create a new page
php artisan lightvel:layout layout-name  # Create a new layout
php artisan lightvel:install             # Publish config + assets
```

---

## JavaScript API (for advanced use)

```javascript
let api = window.Lightvel.js;
api.get('key');              // Read state
api.set('key', value);       // Set state + re-render
api.batch(() => { ... });    // Batch multiple set() calls
api.register('name', fn);   // Register client-side action
```

---

*This file was generated by Lightvel v1.3.49. For full documentation, see README.md.*
