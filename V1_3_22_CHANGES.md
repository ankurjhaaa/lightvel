# Lightvel v1.3.22 - Simplified Architecture

## Breaking Changes

### Removed Specialized Directives
- `light:search` - No longer a special directive. Use `light:click` for search actions.
- `light:search-min` - Not needed with generic action directives
- `light:cache` and `light:cache-ttl` - These were v1.3.20 optimization features that added complexity

**Migration**: Any `light:search="searchUsers"` becomes `light:click="searchUsers()"`. It's the same action trigger.

---

## New Architecture (v1.3.22)

### 1. **Use Standard Laravel Request, Not `$this->state()`**

```php
// ❌ OLD WAY (v1.3.21)
class UsersComponent extends Component {
    public function saveUser() {
        $name = trim((string) $this->state('name', ''));
        // ...
    }
}

// ✅ NEW WAY (v1.3.22)
class UsersComponent extends Component {
    public function saveUser(Request $request) {
        $name = trim((string) $request->input('name', ''));
        // ...
    }
}
```

**Why?** Normal Laravel patterns are familiar. No need for custom state extraction.

---

### 2. **Generic Action Directives**

All actions use `light:click` or `light:submit`. No specialized directives.

```html
<!-- Form submission -->
<form light:submit="saveUser">
    <input type="text" name="name" />
    <button type="submit">Save</button>
</form>

<!-- Click action (same action mechanism, different trigger) -->
<button light:click="deleteUser(user.id)">Delete</button>

<!-- Search is just another action -->
<input 
    type="text" 
    placeholder="Search users..."
    light:click="searchUsers()"
    light:debounce="250ms"
/>
```

**Key Point**: `light:search` was `light:click` with extra naming confusion. Removed.

---

### 3. **Validation Error Display Under Fields**

Use `light:error="fieldName"` to show validation errors under each field.

```html
<div>
    <input 
        type="email" 
        name="email" 
        light:model="email"
    />
    <span light:error="email"></span>
</div>

<div>
    <input 
        type="text" 
        name="name" 
        light:model="name"
    />
    <span light:error="name"></span>
</div>

<button light:submit="saveUser">Save</button>
```

**How it works**:
1. Form submits to `saveUser()` action
2. Server validates (using Laravel's `validate()` method)
3. If validation fails, returns: `{ errors: { email: ["must be valid email"], ... } }`
4. Client automatically displays errors under each field
5. Errors show in red text below the input

---

### 4. **Client-Side Validation FIRST, Server Validation SECOND**

```php
class UsersComponent extends Component {
    // Define rules (optional - for client-side validation)
    public function rules() {
        return [
            'name' => 'required|string|max:100',
            'email' => 'required|email',
        ];
    }

    // Action processes form data (receives Request)
    public function saveUser(Request $request) {
        // Validate (Laravel standard - throws ValidationException if fails)
        $validated = $this->validate();  // Uses rules() above
        
        // Process data
        User::create($validated);
        
        // Return updated state if needed
        return ['users' => User::all()];
    }
}
```

**Flow**:
1. User types and submits → Client validates (check rules)
2. If client validation passes → Send to server
3. Server validates again (always validate on server!)
4. If server validation fails → Errors display under fields
5. If server validation passes → Process what Action returns

---

### 5. **Optional Client State with `light:state` and `light:model`**

For complex interactive UIs, still use client-managed state:

```html
<!-- Initialize state -->
<div light:state='{"search":"","editingId":null,"users":[]}'>
    <!-- Input that syncs to state -->
    <input 
        type="text" 
        light:model="search"
        placeholder="Search..."
    />
    
    <!-- Display from state -->
    <ul light:for="user in users">
        <li light:text="user.name"></li>
    </ul>
</div>
```

**When to use `light:state`?**
- Complex forms with lots of reactive fields
- Live preview/updates as user types
- Multi-step forms
- Editing logic that needs to track UI state

**When NOT to use it?**
- Simple form submission (just use standard form inputs)
- One-time data processing
- Traditional CRUD (create, save, delete)

---

## Example: Simple CRUD without State Bloat

### Component Class

```php
<?php

namespace App\Components;

use Lightvel\Component;
use Illuminate\Http\Request;
use App\Models\User;

class UsersComponent extends Component {
    public function rules() {
        return [
            'name' => 'required|string|max:100',
            'email' => 'required|email|unique:users',
        ];
    }

    // Normal Laravel action - receives Request
    public function createUser(Request $request) {
        // Validate (shows errors under fields automatically)
        $validated = $this->validate();
        
        // Create
        User::create($validated);
        
        // Return what changed (optional)
        return [
            'users' => User::all(),
            'message' => 'User created successfully!',
        ];
    }

    public function deleteUser(Request $request) {
        $id = (int) $request->input('id');
        $user = User::find($id);
        
        if ($user) {
            $user->delete();
        }
        
        return ['users' => User::all()];
    }

    public function searchUsers(Request $request) {
        $query = trim((string) $request->input('q', ''));
        
        if (empty($query)) {
            $users = User::all();
        } else {
            $users = User::where('name', 'like', "%$query%")
                ->orWhere('email', 'like', "%$query%")
                ->get();
        }
        
        return ['users' => $users];
    }

    // Initial page load
    public function lightvel() {
        return [
            'users' => User::all(),
        ];
    }
}
```

### Blade Template

```html
<div data-light-root>
    <h1>Users</h1>

    <!-- FORM TO CREATE USER -->
    <form light:submit="createUser">
        <div>
            <label>Name</label>
            <input 
                type="text" 
                name="name" 
                placeholder="Full name"
                required
            />
            <span light:error="name" 
                  style="color: #dc2626; font-size: 0.875rem;"></span>
        </div>

        <div style="margin-top: 1rem;">
            <label>Email</label>
            <input 
                type="email" 
                name="email" 
                placeholder="user@example.com"
                required
            />
            <span light:error="email"
                  style="color: #dc2626; font-size: 0.875rem;"></span>
        </div>

        <button type="submit" style="margin-top: 1rem;">
            Create User
        </button>
    </form>

    <!-- SEARCH BOX -->
    <div style="margin-top: 2rem;">
        <input 
            type="text" 
            id="searchInput"
            placeholder="Search users..."
            light:click="searchUsers()"
            light:debounce="300ms"
        />
    </div>

    <!-- USERS TABLE -->
    <table style="margin-top: 2rem; width: 100%;">
        <thead>
            <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody light:for="user in users">
            <tr>
                <td light:text="user.name"></td>
                <td light:text="user.email"></td>
                <td>
                    <button 
                        light:click="deleteUser(user.id)"
                        style="background: #ef4444; color: white; padding: 0.5rem 1rem; border: none; border-radius: 0.25rem; cursor: pointer;"
                    >
                        Delete
                    </button>
                </td>
            </tr>
        </tbody>
    </table>

    <!-- Empty state -->
    <div light:if="users.length === 0" style="margin-top: 2rem; text-align: center; color: #999;">
        <p>No users found.</p>
    </div>
</div>

@lightScripts
```

---

## Summary of Changes (v1.3.21 → v1.3.22)

| Feature | v1.3.21 | v1.3.22 |
|---------|---------|---------|
| State extraction | `$this->state('field')` | `$request->input('field')` (standard Laravel) |
| Search directive | `light:search` (specialized) | `light:click` (generic) |
| Caching directives | `light:cache`, `light:cache-ttl` | Removed (added complexity) |
| Validation errors | Manual field-by-field display | Automatic under each field |
| Error styling | No default | Red text, small font (customizable) |
| Request injection | Not supported | Supported (check parameter type) |

---

## Migration Guide from v1.3.21

### Step 1: Update Component Classes

```php
// Change FROM:
public function saveUser() {
    $name = $this->state('name');
    $email = $this->state('email');
}

// Change TO:
public function saveUser(Request $request) {
    $name = $request->input('name');
    $email = $request->input('email');
}
```

### Step 2: Update Templates

```html
<!-- Change FROM (v1.3.21): -->
<input light:search="searchUsers" />

<!-- Change TO (v1.3.22): -->
<input light:click="searchUsers()" />

<!-- The rest stays the same -->
```

### Step 3: Add Error Display

```html
<!-- Add this for each form field: -->
<span light:error="fieldName" style="color: #dc2626; font-size: 0.875rem; display: block; margin-top: 0.25rem;"></span>
```

---

## What Got Removed & Why

1. **`light:search` directive**: It was just `light:click` with a different name. Confusion.
2. **`light:cache` / `light:cache-ttl`**: Added complexity for minimal gain. Most apps don't need response caching at this layer.
3. **Special handling for search actions**: Search is just another action. No special treatment needed.

**Philosophy**: Lightvel should feel like normal Laravel, just reactive. Remove specialized syntax.

---

## Questions?

v1.3.22 follows Laravel principles:
- Use `Request` like normal
- Define `rules()` like normal validation
- Show errors under fields like normal forms
- Directives are for binding, not behavior

The "lightvel" part is just making it reactive without writing JavaScript.
