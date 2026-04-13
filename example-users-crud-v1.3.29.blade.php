@php
use Lightvel\Component;
use Lightvel\Layout;
use Illuminate\Http\Request;

new #[Layout('app')] class extends Component {
    protected function usersQuery()
    {
        return \App\Models\User::query()->latest();
    }

    public function lightvel(): array
    {
        return [
            'users' => $this->usersQuery()->limit(10)->get(),
            'search' => '',
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'password' => '',
            'message' => '',
        ];
    }

    public function searchUsers(Request $request): array
    {
        $search = (string) $request->input('search', '');

        $query = $this->usersQuery();

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

    public function store(Request $request): array
    {
        $validated = $request->validate([
            'name' => 'required|min:3|max:100',
            'email' => 'required|email|unique:users,email',
            'password' => 'required|min:6',
        ]);

        \App\Models\User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => bcrypt($validated['password']),
        ]);

        return [
            'users' => $this->usersQuery()->limit(10)->get(),
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'password' => '',
            'message' => 'User created successfully',
        ];
    }

    public function update(Request $request): array
    {
        $id = (int) $request->input('editingId');
        $user = \App\Models\User::find($id);

        if (! $user) {
            return ['message' => 'User not found'];
        }

        $validated = $request->validate([
            'name' => 'required|min:3|max:100',
            'email' => 'required|email|unique:users,email,' . $id,
            'password' => 'required|min:6',
        ]);

        $user->update([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => bcrypt($validated['password']),
        ]);

        return [
            'users' => $this->usersQuery()->limit(10)->get(),
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'password' => '',
            'message' => 'User updated successfully',
        ];
    }

    public function deleteUser(Request $request): array
    {
        $id = (int) $request->input('id');
        \App\Models\User::find($id)?->delete();

        return [
            'users' => $this->usersQuery()->limit(10)->get(),
            'message' => 'User deleted successfully',
        ];
    }
};
@endphp

<div
    light:state='{"users":[],"search":"","showModal":false,"editingId":null,"name":"","email":"","password":"","message":""}'
    class="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
>
    <div class="mb-8 flex items-center justify-between">
        <h1 class="text-4xl font-bold text-gray-900">Users CRUD</h1>
        <button
            type="button"
            light:function="showModal=true, editingId=null, name='', email='', password=''"
            class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
        >
            + New User
        </button>
    </div>

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
                <tr light:for="users|@user">
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-900" light:text="user.name"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-500" light:text="user.email"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-sm text-gray-500" light:text="user.created_at"></td>
                    <td class="border-t border-gray-200 px-6 py-4 text-right">
                        <div class="flex justify-end gap-2">
                            <button
                                type="button"
                                light:function="showModal=true, editingId=user.id, name=user.name, email=user.email, password=''"
                                class="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                            >
                                Edit
                            </button>

                            <form light:submit="deleteUser" class="inline">
                                <input type="hidden" name="id" light:bind="user.id" />
                                <button
                                    type="submit"
                                    class="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                                >
                                    Delete
                                </button>
                            </form>
                        </div>
                    </td>
                </tr>
                <tr light:if="users.length === 0">
                    <td colspan="4" class="border-t border-gray-200 px-6 py-8 text-center text-sm text-gray-500">
                        Loading users...
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <div light:if="showModal" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40" light:function="showModal=false"></div>

        <div class="relative w-full max-w-md rounded-lg bg-white shadow-lg">
            <button
                type="button"
                light:function="showModal=false"
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

            <form light:submit="editingId ? 'update' : 'store'" class="space-y-4 px-6 py-4">
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

                <div light:if="message" class="rounded-lg bg-green-50 p-3 text-sm text-green-700">
                    <span light:text="message"></span>
                </div>

                <div class="flex gap-3 pt-4">
                    <button
                        type="button"
                        light:function="showModal=false"
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
