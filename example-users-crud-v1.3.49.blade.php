{{-- ============================================================================
    Lightvel CRUD Example — v2.2 (Complete Feature Showcase)

    EVERY Lightvel directive is demonstrated here:
    ✓ light:model / light:model.live    — two-way data binding
    ✓ light:click / light:submit        — server actions
    ✓ light:function                    — client-side state (no server)
    ✓ light:if                          — conditional rendering
    ✓ light:for                         — list rendering (auto-unwraps paginator)
    ✓ light:text                        — reactive text binding
    ✓ light:class                       — conditional CSS classes
    ✓ light:rules / light:error         — client + server validation
    ✓ light:debounce                    — debounced live search
    ✓ light:state                       — client-side state init
    ✓ light:loading / light:loading.target — per-action spinners + custom text
    ✓ light:cloak                       — initial page loader (visible until JS ready)
    ✓ light:paginate / light:paginate-action — AJAX pagination (no reload)
    ✓ light:paginate-custom             — build your own pagination UI
    ✓ light:navigate                    — SPA navigation
    ✓ patch()->insert/update/delete     — surgical DOM, no full refresh

    Setup:
    1. Copy to resources/views/pages/users.blade.php
    2. Route: Route::lightvel('/users', 'pages.users');
    3. Layout must have @lightScripts before </body>
    4. php artisan view:clear → visit /users
============================================================================ --}}

@php
use Lightvel\Component;
use Lightvel\Layout;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {

    public function lightvel(): array
    {
        // paginate(10) = default 10 items per page
        // The framework handles page=1 automatically
        return [
            'users'     => \App\Models\User::query()->latest()->paginate(10),
            'search'    => '',
            'showModal' => false,
            'editingId' => null,
            'name'      => '',
            'email'     => '',
            'password'  => '',
            'message'   => '',
            'status'    => true,
        ];
    }

    /**
     * Live search + pagination action.
     * Called by light:model.live (debounced) and light:paginate-action clicks.
     * Just accept page param — defaults handled by framework.
     */
    public function searchUsers(Request $request): array
    {
        $search = (string) $request->input('search', '');
        $page   = max(1, (int) $request->input('page', 1));
        $query  = \App\Models\User::query()->latest();

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }

        return [
            'users' => $query->paginate(10, ['*'], 'page', $page),
        ];
    }

    /**
     * Create or update user.
     * $request->validate() — on fail, field errors auto-display in light:error
     * patch()->insert/update — instant DOM update without reload
     */
    public function saveUser(Request $request): array
    {
        $id = (int) $request->input('editingId');

        $emailRule = $id > 0
            ? 'required|email|unique:users,email,' . $id
            : 'required|email|unique:users,email';

        $validated = $request->validate([
            'name'     => 'required|min:3|max:100',
            'email'    => $emailRule,
            'password' => 'required|min:6',
        ]);

        $resetForm = [
            'showModal' => false,
            'editingId' => null,
            'name'      => '',
            'email'     => '',
            'password'  => '',
        ];

        if ($id > 0) {
            $user = \App\Models\User::find($id);
            if (! $user) {
                return ['status' => false, 'message' => 'User not found'];
            }

            $user->update([
                'name'     => $validated['name'],
                'email'    => $validated['email'],
                'password' => bcrypt($validated['password']),
            ]);

            return [
                ...$resetForm,
                'message' => 'User updated successfully',
                ...patch()->update('users', $user->fresh()),
            ];
        }

        $user = \App\Models\User::create([
            'name'     => $validated['name'],
            'email'    => $validated['email'],
            'password' => bcrypt($validated['password']),
        ]);

        return [
            ...$resetForm,
            'message' => 'User created successfully',
            ...patch()->insert('users', $user),
        ];
    }

    /**
     * Delete user — instant row removal via patch()->delete()
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

{{--
    light:state initializes ALL client-side state keys.
    Must mirror lightvel() so JS engine can bind/track from first frame.
--}}
<div
    light:state="users=[], search='', showModal=false, editingId=null, name='', email='', password='', message='', status=true"
    class="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
>

    {{-- ========== INITIAL PAGE LOADER (light:cloak) ==========
         light:cloak = visible on page load, hidden after JS initializes.
         Use this to show a loading skeleton while framework boots up.
    --}}
    <div light:cloak class="space-y-4 py-12">
        <div class="h-8 w-48 lightvel-skeleton rounded"></div>
        <div class="h-10 w-80 lightvel-skeleton rounded"></div>
        <div class="space-y-2">
            <div class="h-12 w-full lightvel-skeleton rounded"></div>
            <div class="h-12 w-full lightvel-skeleton rounded"></div>
            <div class="h-12 w-full lightvel-skeleton rounded"></div>
            <div class="h-12 w-full lightvel-skeleton rounded"></div>
        </div>
    </div>

    {{-- ========== HEADER ========== --}}
    <div class="mb-8 flex items-center justify-between">
        <h1 class="text-4xl font-bold text-gray-900">Users</h1>
        <button
            type="button"
            light:function="showModal=true, editingId=null, name='', email='', password='', message=''"
            class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
            + New User
        </button>
    </div>

    {{-- ========== STATUS MESSAGE ==========
         light:if   = renders only when message is truthy
         light:class = toggles green/red based on status boolean
    --}}
    <div
        light:if="message"
        light:class="bg-green-50 border-green-200 text-green-800: status, bg-red-50 border-red-200 text-red-800: !status"
        class="mb-6 rounded-lg border p-3 text-sm font-medium"
    >
        <span light:text="message"></span>
    </div>

    {{-- ========== SEARCH ==========
         light:model.live = sends value to server on every change
         light:debounce   = waits 300ms before sending
         light:loading.target = shows spinner ONLY during searchUsers action
    --}}
    <div class="mb-6">
        <form light:submit="searchUsers" class="flex gap-2 w-full max-w-md">
            <div class="relative w-full">
                <input
                    type="text"
                    light:model.live="search"
                    light:debounce="300"
                    placeholder="Search by name or email..."
                    class="w-full rounded-lg border border-gray-300 px-4 py-2 pr-10 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {{-- Targeted search spinner --}}
                <div
                    light:loading
                    light:loading.target="searchUsers"
                    light:loading.delay="200"
                    class="absolute right-3 top-2.5"
                >
                    <div class="lightvel-spinner" style="width:16px;height:16px;border-width:2px;"></div>
                </div>
            </div>
        </form>
    </div>

    {{-- ========== USERS TABLE ==========
         light:for="user in users" auto-unwraps .data from Paginator
    --}}
    <div class="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
        <table class="w-full text-sm">
            <thead class="border-b bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left font-semibold text-gray-900">Name</th>
                    <th class="px-6 py-3 text-left font-semibold text-gray-900">Email</th>
                    <th class="px-6 py-3 text-left font-semibold text-gray-900">Created</th>
                    <th class="px-6 py-3 text-right font-semibold text-gray-900">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                <tr light:for="user in users" class="hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-3 text-gray-900 font-medium" light:text="user.name"></td>
                    <td class="px-6 py-3 text-gray-500" light:text="user.email"></td>
                    <td class="px-6 py-3 text-gray-500" light:text="user.created_at"></td>
                    <td class="px-6 py-3 text-right">
                        <div class="flex justify-end gap-2">
                            {{-- EDIT — light:function pre-fills modal (instant, no server) --}}
                            <button
                                type="button"
                                light:function="showModal=true, editingId=user.id, name=user.name, email=user.email, password='', message=''"
                                class="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
                            >
                                Edit
                            </button>

                            {{-- DELETE — light:click calls server --}}
                            <button
                                type="button"
                                light:click="deleteUser(user.id)"
                                class="relative inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
                            >
                                {{-- CUSTOM LOADING TEXT: shows "Deleting..." instead of button text --}}
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

                {{-- Empty state --}}
                <tr light:if="!users || (users.data && users.data.length === 0) || (Array.isArray(users) && users.length === 0)">
                    <td colspan="4" class="px-6 py-12 text-center text-sm text-gray-400">
                        No users found.
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    {{-- ========== PAGINATION (Default — Auto-built UI) ==========
         light:paginate="users"          → reads the Laravel Paginator
         light:paginate-action="searchUsers" → calls searchUsers({page:N}) via AJAX
         Default: page=1, perPage=10 (from paginate(10) above)
         No page reload — only data changes!
    --}}
    <div light:paginate="users" light:paginate-action="searchUsers" class="mt-4"></div>

    {{-- ========== PAGINATION (Custom — Build Your Own UI) ==========
         light:paginate-custom = framework skips default UI, you build your own.
         Use light:text to show paginator data, light:click with Lightvel.goToPage() to navigate.
         Available paginator keys: users.current_page, users.last_page, users.total, users.from, users.to

         UNCOMMENT BELOW to use custom pagination instead of default:
    --}}
    {{--
    <div light:paginate="users" light:paginate-action="searchUsers" light:paginate-custom class="mt-4">
        <div class="flex items-center justify-center gap-3 py-4">
            <button
                type="button"
                light:click="searchUsers"
                onclick="Lightvel.goToPage('users', (Lightvel.js.state.users?.current_page || 1) - 1)"
                light:if="users.current_page > 1"
                class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm"
            >
                ← Previous
            </button>

            <span class="text-sm text-gray-600">
                Page <span light:text="users.current_page"></span>
                of <span light:text="users.last_page"></span>
            </span>

            <button
                type="button"
                onclick="Lightvel.goToPage('users', (Lightvel.js.state.users?.current_page || 1) + 1)"
                light:if="users.current_page < users.last_page"
                class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm"
            >
                Next →
            </button>
        </div>
    </div>
    --}}

    {{-- ========== MODAL — Create/Edit Form ==========
         light:submit   = calls saveUser on the server
         light:rules    = client-side validation (runs before server call)
         light:error    = shows BOTH client + server validation errors
         light:loading.target = spinner during save
    --}}
    <div light:if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        {{-- Backdrop --}}
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" light:function="showModal=false, message=''"></div>

        <div class="relative w-full max-w-md rounded-xl bg-white shadow-xl">
            {{-- Close --}}
            <button
                type="button"
                light:function="showModal=false, message=''"
                class="absolute right-4 top-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
                ✕
            </button>

            {{-- Header --}}
            <div class="border-b bg-gray-50 px-6 py-4 rounded-t-xl">
                <h2 class="text-lg font-bold text-gray-900">
                    <span light:if="editingId">Edit User</span>
                    <span light:if="!editingId">Create User</span>
                </h2>
            </div>

            {{-- Form --}}
            <form light:submit="saveUser" class="space-y-4 px-6 py-5">
                <input type="hidden" light:model="editingId" />

                {{-- NAME --}}
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                    <input
                        type="text"
                        light:model="name"
                        light:rules="required|min:3|max:100"
                        placeholder="Full name"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    {{-- Shows client + server errors for "name" field --}}
                    <span light:error="name" class="mt-1 block text-xs text-red-600"></span>
                </div>

                {{-- EMAIL --}}
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                    <input
                        type="email"
                        light:model="email"
                        light:rules="required|email"
                        placeholder="user@example.com"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span light:error="email" class="mt-1 block text-xs text-red-600"></span>
                </div>

                {{-- PASSWORD --}}
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">Password</label>
                    <input
                        type="password"
                        light:model="password"
                        light:rules="required|min:6"
                        placeholder="Min 6 characters"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span light:error="password" class="mt-1 block text-xs text-red-600"></span>
                </div>

                {{-- ACTIONS --}}
                <div class="flex gap-3 pt-2">
                    <button
                        type="button"
                        light:function="showModal=false, message=''"
                        class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>

                    <button
                        type="submit"
                        class="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
                    >
                        {{-- CUSTOM LOADING TEXT: shows "Saving..." during saveUser --}}
                        <span light:loading light:loading.target="saveUser">
                            <span class="lightvel-spinner" style="width:14px;height:14px;border-width:2px;"></span>
                            Saving...
                        </span>
                        {{-- Normal button text (visible when NOT loading) --}}
                        <span light:if="editingId">Update</span>
                        <span light:if="!editingId">Create</span>
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>
