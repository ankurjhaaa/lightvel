{{-- ============================================================================
    Lightvel CRUD Example — v2.3 (Complete Feature Showcase)

    EVERY Lightvel directive is demonstrated with inline comments.
    Copy to: resources/views/pages/users.blade.php
    Route:   Route::lightvel('/users', 'pages.users');
    Layout:  Must have @lightScripts before </body>
    Then:    php artisan view:clear → visit /users
============================================================================ --}}

@php
use Lightvel\Component;
use Lightvel\Layout;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {

    public function lightvel(): array
    {
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
                ...patch()->update('users', $user),
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

    {{-- ===== INITIAL PAGE LOADER (light:cloak) =====
         Visible on page load, hidden after JS initializes.
         Use lightvel-skeleton class for shimmer effect.
    --}}
    <div light:cloak class="space-y-4 py-8">
        <div class="flex items-center justify-between">
            <div class="h-10 w-48 lightvel-skeleton rounded"></div>
            <div class="h-10 w-32 lightvel-skeleton rounded"></div>
        </div>
        <div class="h-10 w-80 lightvel-skeleton rounded"></div>
        <div class="rounded-lg border border-gray-200 overflow-hidden">
            <div class="h-12 w-full lightvel-skeleton"></div>
            <div class="h-12 w-full lightvel-skeleton" style="opacity:0.7"></div>
            <div class="h-12 w-full lightvel-skeleton" style="opacity:0.5"></div>
            <div class="h-12 w-full lightvel-skeleton" style="opacity:0.3"></div>
        </div>
    </div>

    {{-- ===== HEADER ===== --}}
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

    {{-- ===== STATUS MESSAGE ===== --}}
    <div
        light:if="message"
        light:class="bg-green-50 border-green-200 text-green-800: status, bg-red-50 border-red-200 text-red-800: !status"
        class="mb-6 rounded-lg border p-3 text-sm font-medium"
    >
        <span light:text="message"></span>
    </div>

    {{-- ===== SEARCH ===== --}}
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

    {{-- ===== USERS TABLE ===== --}}
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
                            <button
                                type="button"
                                light:function="showModal=true, editingId=user.id, name=user.name, email=user.email, password='', message=''"
                                class="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
                            >
                                Edit
                            </button>

                            {{-- BUTTON TEXT SWAP: "Delete" → spinner while deleting
                                 light:loading shows the spinner
                                 light:loading.remove hides the normal text
                            --}}
                            <button
                                type="button"
                                light:click="deleteUser(user.id)"
                                class="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
                            >
                                <span
                                    light:loading
                                    light:loading.target="deleteUser"
                                    class="lightvel-spinner"
                                    style="width:12px;height:12px;border-width:2px;"
                                ></span>
                                <span light:loading.remove>Delete</span>
                            </button>
                        </div>
                    </td>
                </tr>

                <tr light:if="!users || (users.data && users.data.length === 0) || (Array.isArray(users) && users.length === 0)">
                    <td colspan="4" class="px-6 py-12 text-center text-sm text-gray-400">
                        No users found.
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    {{-- ===== PAGINATION (AJAX, no page reload) ===== --}}
    <div light:paginate="users" light:paginate-action="searchUsers" class="mt-4"></div>

    {{-- ===== MODAL ===== --}}
    <div light:if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" light:function="showModal=false, message=''"></div>

        <div class="relative w-full max-w-md rounded-xl bg-white shadow-xl">
            <button
                type="button"
                light:function="showModal=false, message=''"
                class="absolute right-4 top-4 text-gray-400 hover:text-gray-600 transition-colors"
            >✕</button>

            <div class="border-b bg-gray-50 px-6 py-4 rounded-t-xl">
                <h2 class="text-lg font-bold text-gray-900">
                    <span light:if="editingId">Edit User</span>
                    <span light:if="!editingId">Create User</span>
                </h2>
            </div>

            <form light:submit="saveUser" class="space-y-4 px-6 py-5">
                <input type="hidden" light:model="editingId" />

                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                    <input
                        type="text"
                        light:model="name"
                        light:rules="required|min:3|max:100"
                        placeholder="Full name"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span light:error="name" class="mt-1 block text-xs text-red-600"></span>
                </div>

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

                <div class="flex gap-3 pt-2">
                    <button
                        type="button"
                        light:function="showModal=false, message=''"
                        class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>

                    {{-- BUTTON TEXT SWAP: "Save/Update" → "Saving..." while saving --}}
                    <button
                        type="submit"
                        class="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
                    >
                        {{-- Shows during saveUser --}}
                        <span light:loading light:loading.target="saveUser">
                            <span class="lightvel-spinner" style="width:14px;height:14px;border-width:2px;"></span>
                            Saving...
                        </span>
                        {{-- Hidden during saveUser --}}
                        <span light:loading.remove>
                            <span light:if="editingId">Update</span>
                            <span light:if="!editingId">Create</span>
                        </span>
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>
