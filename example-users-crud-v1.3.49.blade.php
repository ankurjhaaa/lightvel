{{-- ============================================================================
    Lightvel CRUD Example — v1.3.49 (Optimized)

    This example demonstrates all major Lightvel features:
    ✓ Component class with lightvel() initial state
    ✓ Server actions (saveUser, deleteUser, searchUsers)
    ✓ patch() for surgical client-side array updates (no full refresh)
    ✓ light:model / light:model.live (two-way binding)
    ✓ light:click (server action with args)
    ✓ light:submit (form submission)
    ✓ light:function (client-side-only state change — INSTANT, no server)
    ✓ light:if (conditional rendering)
    ✓ light:for (list rendering)
    ✓ light:text (reactive text binding)
    ✓ light:rules + light:error (client-side validation)
    ✓ light:debounce (debounced live search)
    ✓ light:state (client-side state initialization)

    Setup:
    1. Copy this file to resources/views/pages/users.blade.php
    2. Add route: Route::lightvel('/users', 'pages.users');
    3. Make sure your layout has @lightScripts before </body>
    4. Run: php artisan view:clear
    5. Visit /users
============================================================================ --}}

@php
use Lightvel\Component;
use Lightvel\Layout;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {

    /**
     * Initial state — runs ONLY on first page load (GET request).
     * On AJAX actions this is SKIPPED for maximum speed.
     */
    public function lightvel(): array
    {
        return [
            'users' => \App\Models\User::query()->latest()->limit(10)->get(),
            'search' => '',
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'password' => '',
            'message' => '',
        ];
    }

    /**
     * Live search — called on every keystroke (debounced 300ms).
     * Returns only the updated 'users' array — no full page refresh.
     */
    public function searchUsers(Request $request): array
    {
        $search = (string) $request->input('search', '');

        $query = \App\Models\User::query()->latest();

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        return [
            'users' => $query->limit(10)->get(),
        ];
    }

    /**
     * Create or update a user.
     * Uses patch()->insert() / patch()->update() for surgical DOM updates —
     * the JS runtime modifies only the affected row instead of replacing the whole table.
     */
    public function saveUser(Request $request): array
    {
        $id = (int) $request->input('editingId');
        $resetForm = [
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'password' => '',
        ];

        $emailRule = $id > 0
            ? 'required|email|unique:users,email,' . $id
            : 'required|email|unique:users,email';

        $validated = $request->validate([
            'name' => 'required|min:3|max:100',
            'email' => $emailRule,
            'password' => 'required|min:6',
        ]);

        if ($id > 0) {
            $user = \App\Models\User::find($id);

            if (! $user) {
                return ['message' => 'User not found'];
            }

            $user->update([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => bcrypt($validated['password']),
            ]);

            return [
                ...$resetForm,
                'message' => 'User updated successfully',
                ...patch()->update('users', $user->fresh()),
            ];
        } else {
            $user = \App\Models\User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => bcrypt($validated['password']),
            ]);

            return [
                ...$resetForm,
                'message' => 'User created successfully',
                ...patch()->insert('users', $user),
            ];
        }
    }

    /**
     * Delete a user.
     * patch()->delete() removes the row from the client-side array instantly.
     */
    public function deleteUser(int $id): array
    {
        $deleted = \App\Models\User::find($id)?->delete();

        if (! $deleted) {
            return ['message' => 'User not found'];
        }

        return [
            'message' => 'User deleted successfully',
            ...patch()->delete('users', $id),
        ];
    }
};
@endphp

<div
    light:state="users=[], search='', showModal=false, editingId=null, name='', email='', password='', message=''"
    class="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
>
    {{-- Header + New User button --}}
    <div class="mb-8 flex items-center justify-between">
        <h1 class="text-4xl font-bold text-gray-900">Users CRUD</h1>

        {{-- light:function = instant client-side state change (no server call) --}}
        <button
            type="button"
            light:function="showModal=true, editingId=null, name='', email='', password='', message=''"
            class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
        >
            + New User
        </button>
    </div>

    {{-- Status message --}}
    <div light:if="message" class="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
        <span light:text="message"></span>
    </div>

    {{-- Search with debounced live search --}}
    <div class="mb-6">
        <form light:submit="searchUsers" class="flex gap-2">
            <input
                type="text"
                light:model.live="search"
                light:debounce="300"
                placeholder="Search by name or email..."
                class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-indigo-500 focus:outline-none"
            />
        </form>
    </div>

    {{-- Users table --}}
    <div class="overflow-hidden rounded-lg border border-gray-200 shadow">
        <table class="w-full">
            <thead class="border-b bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">Name</th>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">Created</th>
                    <th class="px-6 py-3 text-right text-sm font-semibold text-gray-900">Actions</th>
                </tr>
            </thead>
            <tbody>
                {{-- light:for loops through the users array --}}
                <tr light:for="user in users">
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-900" light:text="user.name"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-500" light:text="user.email"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-500" light:text="user.created_at"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-right">
                        <div class="flex justify-end gap-2">
                            {{-- light:function opens modal with user data pre-filled (instant, no server) --}}
                            <button
                                type="button"
                                light:function="showModal=true, editingId=user.id, name=user.name, email=user.email, password='', message=''"
                                class="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                            >
                                Edit
                            </button>

                            {{-- light:click sends the user.id to deleteUser() on the server --}}
                            <button
                                type="button"
                                light:click="deleteUser(user.id)"
                                class="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                            >
                                Delete
                            </button>
                        </div>
                    </td>
                </tr>

                {{-- Empty state --}}
                <tr light:if="users.length === 0">
                    <td colspan="4" class="border-t border-gray-200 px-6 py-8 text-center text-sm text-gray-500">
                        No users found.
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    {{-- Modal (create/edit user) --}}
    <div light:if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        {{-- Backdrop — click to close (instant, no server) --}}
        <div class="absolute inset-0 bg-black/40" light:function="showModal=false, message=''"></div>

        <div class="relative w-full max-w-md rounded-lg bg-white shadow-lg">
            <button
                type="button"
                light:function="showModal=false, message=''"
                class="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
                ✕
            </button>

            <div class="border-b bg-gray-50 px-6 py-4">
                <h2 class="text-lg font-bold text-gray-900">
                    <span light:if="editingId">Edit User</span>
                    <span light:if="!editingId">Create User</span>
                </h2>
            </div>

            {{-- light:submit sends form data to saveUser() on the server --}}
            <form light:submit="saveUser" class="space-y-4 px-6 py-4">
                <input type="hidden" light:model="editingId" />

                <div>
                    <label class="block text-sm font-semibold text-gray-900">Name</label>
                    <input
                        type="text"
                        light:model="name"
                        light:rules="required|min:3|max:100"
                        placeholder="Enter name"
                        class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none"
                    />
                    {{-- light:error shows validation errors for this field --}}
                    <span light:error="name" class="mt-1 block text-sm text-red-600"></span>
                </div>

                <div>
                    <label class="block text-sm font-semibold text-gray-900">Email</label>
                    <input
                        type="email"
                        light:model="email"
                        light:rules="required|email"
                        placeholder="Enter email"
                        class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none"
                    />
                    <span light:error="email" class="mt-1 block text-sm text-red-600"></span>
                </div>

                <div>
                    <label class="block text-sm font-semibold text-gray-900">Password</label>
                    <input
                        type="password"
                        light:model="password"
                        light:rules="required|min:6"
                        placeholder="Enter password"
                        class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none"
                    />
                    <span light:error="password" class="mt-1 block text-sm text-red-600"></span>
                </div>

                <div class="flex gap-3 pt-4">
                    <button
                        type="button"
                        light:function="showModal=false, message=''"
                        class="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        class="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
                    >
                        <span light:if="editingId">Update</span>
                        <span light:if="!editingId">Create</span>
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>
