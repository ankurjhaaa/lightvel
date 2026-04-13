# Lightvel

Lightvel is a lightweight reactive layer for Laravel Blade pages.

It keeps Laravel-style request/response flow and adds simple reactive state in Blade.

## Installation

```bash
composer require lightvel/lightvel
php artisan lightvel:install
```

## Route Style

```php
use Illuminate\Support\Facades\Route;

Route::lightvel('/', 'pages.home')->name('home');
```

## Basic Page

```blade
@php
use Lightvel\Component;
use Lightvel\Layout;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {
    public function lightvel(): array
    {
        return [
            'count' => 0,
            'message' => '',
        ];
    }

    public function increment(Request $request): array
    {
        $count = (int) $request->input('count', 0) + 1;
        return ['count' => $count];
    }
};
@endphp

<div light:state='{"count":0,"message":""}'>
    <button light:click="increment">+</button>
    <span light:text="count"></span>
</div>
```

## Supported Directives (Current)

These directives are currently mapped and supported in this package:

- `light:state`
- `light:model`
- `light:model.live`
- `light:click`
- `light:submit`
- `light:function`
- `light:text`
- `light:if`
- `light:show`
- `light:for`
- `light:class`
- `light:const`
- `light:function`
- `light:rules`
- `light:debounce`
- `light:error`
- `light:error-message`
- `light:navigate`

## Validation Flow

Lightvel validation runs in 2 steps:

1. **Client-side (live)** using `light:rules` for quick checks.
2. **Server-side (submit/live action)** using Laravel validation for final checks like `unique`, `exists`, etc.

### Client-side Example

```blade
<input name="name" light:model="name" light:rules="required|min:3|max:100" />
<span light:error="name"></span>
```

### Server-side Example

```php
use Illuminate\Http\Request;

public function store(Request $request): array
{
    $validated = $request->validate([
        'name' => ['required', 'min:3', 'max:100'],
        'email' => ['required', 'email', 'unique:users,email'],
    ]);

    // Save and return updated state
    return ['message' => 'Saved'];
}
```

Server validation errors are rendered in the same `light:error` field slots.

## Action Response Strategies (Minimize Payload)

Since `toArray()` bloats payloads, Lightvel offers 3 strategies:

### 1) Return `null` or nothing

For actions that just persist data but don't need to send state back:

```php
public function store(Request $request)
{
    $validated = $request->validate([
        'name' => ['required', 'unique:users,name'],
    ]);

    User::create($validated);
    
    // No return = minimal payload, just validation errors if any
}
```

### 2) Return only specific keys

Send back only the data that changed:

```php
public function store(Request $request): array
{
    $validated = $request->validate([
        'name' => ['required', 'unique:users,name'],
    ]);

    $user = User::create($validated);
    return ['message' => 'User created', 'lastId' => $user->id];
}
```

### 3) Return only delta (changed fields)

For forms, return only fields that differ from initial state:

```php
public function update(Request $request): array
{
    $validated = $request->validate([
        'name' => ['required', 'unique:users,name,' . auth()->id()],
    ]);

    auth()->user()->update($validated);
    
    // Send back only changed fields
    return $this->getDeltaState();
}
```

All strategies keep validation errors in `light:error` slots automatically.

## `light:model` vs `light:model.live`

- `light:model`: only updates client state.
- `light:model.live`: updates client state and triggers nearest `form[light:submit]` action (debounced if set).

## Client-only actions

Use `light:function` when a button should only update client state and must not hit the server.

You can use it in 2 ways:

1. **Inline assignment mode (same-line HTML, no script required)**
2. **Named custom function mode (via `window.Lightvel.functions`)**

### 1) Inline assignment mode

```blade
<button light:function="editingId=user.id, name=user.name, email=user.email, password=''">
    Edit
</button>
```

Rules:

- Use `key=value` pairs
- Multiple updates separated by comma
- Right side can use current state vars, scoped loop vars (`user.name`), strings, numbers, booleans
- This mode is fully client-side (no server hit)

### 2) Named custom function mode

Example:

```blade
<button light:function="openEdit(user.id, user.name, user.email)">Edit</button>
```

Define it once in the browser:

```html
<script>
window.Lightvel = window.Lightvel || {};
window.Lightvel.functions = window.Lightvel.functions || {};
window.Lightvel.functions.openEdit = (id, name, email, { set }) => {
    set('editingId', id);
    set('name', name);
    set('email', email);
    set('password', '');
};
</script>
```

That function runs in the browser and can fill inputs from client state. Save/update should still go through `light:submit`.

## Performance Notes

- Input syncing is frame-batched to reduce typing lag.
- Prefer `light:model.live` only where live server interaction is needed.
- Keep heavy `light:for` sections scoped to only required state keys.

## Troubleshooting

### Action not firing

Ensure layout has:

```blade
<meta name="csrf-token" content="{{ csrf_token() }}">
@lightScripts
```

### 405 errors

Use Lightvel route macro format:

```php
Route::lightvel('/path', 'pages.example')->name('example');
```

### After update

```bash
php artisan optimize:clear
```

## License

MIT
