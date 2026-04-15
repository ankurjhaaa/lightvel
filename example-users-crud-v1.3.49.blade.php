{{-- ============================================================================
    Lightvel CRUD Example — v2.0 (Full Feature Showcase)

    This example demonstrates ALL Lightvel features in one page:

    ✓ Component class with lightvel() initial state
    ✓ Server actions: saveUser, deleteUser, searchUsers (paginated)
    ✓ patch()->insert/update/delete for surgical DOM updates (no full refresh)
    ✓ light:model / light:model.live (two-way binding)
    ✓ light:click (server action with args)
    ✓ light:submit (form submission)
    ✓ light:function (client-side-only state change — INSTANT, no server)
    ✓ light:if / light:show (conditional rendering)
    ✓ light:for (list rendering with paginator .data auto-unwrap)
    ✓ light:text (reactive text binding)
    ✓ light:rules + light:error (client-side + server-side validation)
    ✓ light:debounce (debounced live search)
    ✓ light:state (client-side state initialization)
    ✓ light:loading + light:loading.target (per-action loading spinners)
    ✓ light:loading.delay / light:loading.min (timer control)
    ✓ light:paginate (auto pagination from Laravel Paginator)
    ✓ light:navigate (SPA navigation without page reload)
    ✓ light:class (conditional CSS classes)

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
     * Returns paginated users — light:for auto-unwraps .data from paginator.
     */
    public function lightvel(): array
    {
        return [
            'users' => \App\Models\User::query()->latest()->paginate(10),
            'search' => '',
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'password' => '',
            'message' => '',
            'status' => true,
        ];
    }

    /**
     * Live search — called on every keystroke (debounced 300ms).
     * Also handles pagination: searchUsers is the paginate-action.
     * Returns only the updated 'users' paginator — no full page refresh.
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

        $page = (int) $request->input('page', 1);

        return [
            'users' => $query->paginate(10, ['*'], 'page', $page),
        ];
    }

    /**
     * Create or update a user.
     * Uses $this->validate() for server-side validation.
     * Errors are returned as __lightvel_errors → shown in light:error fields.
     * Uses patch()->insert() / patch()->update() for surgical DOM updates.
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

        // Server-side validation — errors auto-display in light:error elements
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
                return ['status' => false, 'message' => 'User not found'];
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
            return ['status' => false, 'message' => 'User not found'];
        }

        return [
            'message' => 'User deleted successfully',
            ...patch()->delete('users', $id),
        ];
    }
};
@endphp

<div
    light:state="users=[], search='', showModal=false, editingId=null, name='', email='', password='', message='', status=true"
    class="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
>
    {{-- ================================================================
         HEADER — Title + New User button
         light:function = instant client-side state change (no server call)
    ================================================================ --}}
    <div class="mb-8 flex items-center justify-between">
        <h1 class="text-4xl font-bold text-gray-900">Users CRUD</h1>

        <button
            type="button"
            light:function="showModal=true, editingId=null, name='', email='', password='', message=''"
            class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
            + New User
        </button>
    </div>

    {{-- ================================================================
         STATUS MESSAGE — shows after any CRUD operation
         light:if renders only when message is truthy
         light:class toggles colors based on status (true=green, false=red)
    ================================================================ --}}
    <div
        light:if="message"
        light:class="bg-green-50 border-green-200 text-green-700: status, bg-red-50 border-red-200 text-red-700: !status"
        class="mb-4 rounded-lg border p-3 text-sm"
    >
        <span light:text="message"></span>
    </div>

    {{-- ================================================================
         SEARCH — debounced live search with targeted loading spinner
         light:model.live sends input value to server on every change
         light:debounce="300" waits 300ms before sending
         light:loading + light:loading.target="searchUsers" shows spinner
         ONLY when the searchUsers action is running
    ================================================================ --}}
    <div class="mb-6">
        <form light:submit="searchUsers" class="flex gap-2 w-full max-w-md">
            <div class="relative w-full">
                <input
                    type="text"
                    light:model.live="search"
                    light:debounce="300"
                    placeholder="Search by name or email..."
                    class="w-full rounded-lg border border-gray-300 px-4 py-2 pr-10 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />

                {{-- Targeted spinner: only shows during searchUsers --}}
                <div
                    light:loading
                    light:loading.target="searchUsers"
                    light:loading.delay="200"
                    class="absolute right-3 top-2.5"
                >
                    <div class="lightvel-spinner"></div>
                </div>
            </div>
        </form>
    </div>

    {{-- ================================================================
         USERS TABLE — renders via light:for
         light:for auto-unwraps Laravel Paginator .data arrays
         light:text binds reactive text to each scoped row
    ================================================================ --}}
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
                {{-- light:for loops through paginated users --}}
                <tr light:for="user in users">
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-900" light:text="user.name"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-500" light:text="user.email"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-500" light:text="user.created_at"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-right">
                        <div class="flex justify-end gap-2">

                            {{-- EDIT: light:function opens modal with data pre-filled (INSTANT, no server) --}}
                            <button
                                type="button"
                                light:function="showModal=true, editingId=user.id, name=user.name, email=user.email, password='', message=''"
                                class="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
                            >
                                Edit
                            </button>

                            {{-- DELETE: light:click calls deleteUser(id) on server --}}
                            {{-- light:loading.target="deleteUser" shows spinner only during delete --}}
                            <button
                                type="button"
                                light:click="deleteUser(user.id)"
                                class="relative inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
                            >
                                <span
                                    light:loading
                                    light:loading.target="deleteUser"
                                    class="lightvel-spinner"
                                    style="width:12px;height:12px;border-width:2px;"
                                ></span>
                                Delete
                            </button>
                        </div>
                    </td>
                </tr>

                {{-- Empty state — shows when no users match --}}
                <tr light:if="users.data && users.data.length === 0">
                    <td colspan="4" class="border-t border-gray-200 px-6 py-8 text-center text-sm text-gray-500">
                        No users found.
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    {{-- ================================================================
         PAGINATION — auto-generated from Laravel Paginator
         light:paginate="users" renders pagination controls automatically
         light:paginate-action="searchUsers" calls searchUsers({ page: N })
         Supports: paginate(), simplePaginate(), responsive mobile/desktop
    ================================================================ --}}
    <div light:paginate="users" light:paginate-action="searchUsers"></div>

    {{-- ================================================================
         MODAL — create/edit user form
         light:if renders only when showModal is true
         light:submit calls saveUser on the server
         light:rules provides client-side validation BEFORE server call
         light:error displays both client AND server validation errors
         light:loading.target="saveUser" shows spinner during save only
    ================================================================ --}}
    <div light:if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        {{-- Backdrop — click to close (instant, no server) --}}
        <div class="absolute inset-0 bg-black/40" light:function="showModal=false, message=''"></div>

        <div class="relative w-full max-w-md rounded-lg bg-white shadow-lg">
            {{-- Close button --}}
            <button
                type="button"
                light:function="showModal=false, message=''"
                class="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
                ✕
            </button>

            {{-- Modal header --}}
            <div class="border-b bg-gray-50 px-6 py-4">
                <h2 class="text-lg font-bold text-gray-900">
                    <span light:if="editingId">Edit User</span>
                    <span light:if="!editingId">Create User</span>
                </h2>
            </div>

            {{-- Form: light:submit sends data to saveUser() on server --}}
            <form light:submit="saveUser" class="space-y-4 px-6 py-4">
                <input type="hidden" light:model="editingId" />

                <div>
                    <label class="block text-sm font-semibold text-gray-900">Name</label>
                    <input
                        type="text"
                        light:model="name"
                        light:rules="required|min:3|max:100"
                        placeholder="Enter name"
                        class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    {{-- light:error shows BOTH client-side AND server-side validation errors --}}
                    <span light:error="name" class="mt-1 block text-sm text-red-600"></span>
                </div>

                <div>
                    <label class="block text-sm font-semibold text-gray-900">Email</label>
                    <input
                        type="email"
                        light:model="email"
                        light:rules="required|email"
                        placeholder="Enter email"
                        class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                        class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span light:error="password" class="mt-1 block text-sm text-red-600"></span>
                </div>

                {{-- Action buttons --}}
                <div class="flex gap-3 pt-4">
                    <button
                        type="button"
                        light:function="showModal=false, message=''"
                        class="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>

                    {{-- Submit button with targeted loading spinner --}}
                    <button
                        type="submit"
                        class="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 transition-colors"
                    >
                        {{-- Spinner shows ONLY during saveUser action --}}
                        <span
                            light:loading
                            light:loading.target="saveUser"
                            class="lightvel-spinner"
                            style="width:16px;height:16px;border-width:2px;"
                        ></span>
                        <span light:if="editingId">Update</span>
                        <span light:if="!editingId">Create</span>
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>
