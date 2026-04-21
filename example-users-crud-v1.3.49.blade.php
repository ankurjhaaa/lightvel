{{--
    Lightvel Example — v1.3.74 Complete Showcase
    Copy to: resources/views/pages/users.blade.php
    Route: Route::lightvel('/users', 'pages.users');
--}}

@php
use Illuminate\Http\Request;
use Lightvel\Component;
use Lightvel\Layout;

new #[Layout('app')] class extends Component {
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
            'selected_ids' => [],
            'subjects_json' => [
                ['name' => 'Math', 'max_marks' => 100],
            ],
            'showAdvanced' => false,
            'avatar_url' => '',
            'avatar_preview_url' => '',
            'rich_html' => '<strong>Live HTML Preview</strong>',
        ];
    }

    public function searchUsers(Request $request): array
    {
        $search = (string) $request->input('search', '');
        $page = max(1, (int) $request->input('page', 1));

        $query = \App\Models\User::query()->latest();
        if ($search !== '') {
            $query->where(function ($builder) use ($search) {
                $builder->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        return [
            'users' => $query->paginate(10, ['*'], 'page', $page),
            'message' => $search !== '' ? 'Search applied' : '',
            'status' => true,
        ];
    }

    public function saveUser(Request $request): array
    {
        $id = (int) $request->input('editingId');

        $emailRule = $id > 0
            ? 'required|email|unique:users,email,' . $id
            : 'required|email|unique:users,email';

        $validated = $request->validate([
            'name' => 'required|min:3|max:100',
            'email' => $emailRule,
            'password' => 'required|min:6',
        ]);

        $resetForm = [
            'showModal' => false,
            'editingId' => null,
            'name' => '',
            'email' => '',
            'password' => '',
        ];

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
                'status' => true,
                'message' => 'User updated successfully',
                ...patch()->update('users', $user),
            ];
        }

        $user = \App\Models\User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => bcrypt($validated['password']),
        ]);

        return [
            ...$resetForm,
            'status' => true,
            'message' => 'User created successfully',
            ...patch()->insert('users', $user),
        ];
    }

    public function deleteUser(int $id): array
    {
        $deleted = \App\Models\User::find($id)?->delete();

        if (! $deleted) {
            return [
                'status' => false,
                'message' => 'User not found',
            ];
        }

        return [
            'status' => true,
            'message' => 'User deleted successfully',
            ...patch()->delete('users', $id),
        ];
    }
};
@endphp

<div
    light:state="users=[], search='', showModal=false, editingId=null, name='', email='', password='', message='', status=true, selected_ids=[], subjects_json=[{name:'Math',max_marks:100}], showAdvanced=false, avatar_url='', avatar_preview_url='', rich_html='<strong>Live HTML Preview</strong>'"
    light:const="appName='Lightvel', appVersion='1.3.74'"
    class="mx-auto max-w-6xl px-4 py-8"
>
    <div light:cloak class="space-y-4 py-8">
        <div class="h-10 w-72 lightvel-skeleton rounded"></div>
        <div class="h-40 w-full lightvel-skeleton rounded"></div>
    </div>

    <header class="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <h1 class="text-2xl font-bold text-gray-900">
                <span light:text="appName"></span>
                <span class="text-sm text-gray-500">v<span light:text="appVersion"></span></span>
            </h1>
            <nav class="flex gap-2 text-sm">
                <a href="/" light:navigate class="rounded border px-3 py-1.5 hover:bg-gray-50">Home</a>
                <a href="/users" light:navigate class="rounded border px-3 py-1.5 hover:bg-gray-50">Users</a>
            </nav>
        </div>

        <p class="mt-3 text-sm text-gray-600">{{ light(search ? 'Searching users...' : 'Type to search users') }}</p>

        <div
            light:if="message"
            class="mt-3 rounded-md border px-3 py-2 text-sm"
            light:attr.class="status ? 'mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700' : 'mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'"
        >
            <span light:bind="message"></span>
        </div>
    </header>

    <section class="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">Live Search (no form wrapper)</label>
            <input
                type="text"
                light:model="search"
                light:model.live="searchUsers"
                light:debounce="300"
                light:attr.placeholder="search ? 'Keep typing...' : 'Search by name/email'"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <div class="mt-2 text-xs text-gray-500">{{ light(search ? 'Filtered mode' : 'Showing all users') }}</div>
        </div>

        <div class="space-y-2">
            <button
                type="button"
                light:function="showModal=true, editingId=null, name='', email='', password='', message=''"
                class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
                + New User
            </button>

            <button
                type="button"
                light:function="showAdvanced=!showAdvanced"
                class="ml-2 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
            >
                {{ light(showAdvanced ? 'Hide Advanced' : 'Show Advanced') }}
            </button>
        </div>
    </section>

    <section class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table class="w-full text-sm">
            <thead class="border-b bg-gray-50">
                <tr>
                    <th class="px-4 py-3 text-left">Select</th>
                    <th class="px-4 py-3 text-left">Name</th>
                    <th class="px-4 py-3 text-left">Email</th>
                    <th class="px-4 py-3 text-right">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                <tr light:for="user in users" class="hover:bg-gray-50">
                    <td class="px-4 py-3">
                        <input
                            type="checkbox"
                            light:array.check="selected_ids, Number(user.id)"
                            light:array.add="selected_ids, Number(user.id)"
                        />
                    </td>
                    <td class="px-4 py-3" light:text="user.name"></td>
                    <td class="px-4 py-3" light:text="user.email"></td>
                    <td class="px-4 py-3 text-right">
                        <button
                            type="button"
                            light:function="showModal=true, editingId=user.id, name=user.name, email=user.email, password='secret123', message=''"
                            class="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                        >
                            Edit
                        </button>
                        <button
                            type="button"
                            light:click="deleteUser(user.id)"
                            class="ml-2 inline-flex items-center gap-2 rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                        >
                            <span light:loading light:loading.target="deleteUser" class="lightvel-spinner" style="width:12px;height:12px;border-width:2px;"></span>
                            <span light:loading.remove>Delete</span>
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>

        <div light:if="selected_ids.length > 0" class="border-t bg-gray-50 p-3 text-xs text-gray-700">
            Selected IDs: {{ light(selected_ids.join(', ')) }}
        </div>
    </section>

    <div light:paginate="users" light:paginate-action="searchUsers" class="mt-4"></div>

    <section light:show="showAdvanced" class="mt-6 grid gap-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:grid-cols-2">
        <div>
            <h3 class="mb-3 text-base font-semibold text-gray-900">JSON + Conditional Print</h3>

            <button
                type="button"
                light:json.add="subjects_json, {name:'', max_marks:100}"
                class="mb-3 rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
            >
                + Add Subject Row
            </button>

            <div class="space-y-2">
                <div light:for="subject in subjects_json" class="grid grid-cols-12 gap-2">
                    <input class="col-span-5 rounded border px-2 py-1 text-xs" light:model="subject.name" placeholder="Subject" />
                    <input class="col-span-4 rounded border px-2 py-1 text-xs" type="number" light:model="subject.max_marks" placeholder="Marks" />
                    <button class="col-span-3 rounded border px-2 py-1 text-xs hover:bg-gray-50" type="button" light:json.remove="subjects_json, $index, 'index'">Remove</button>
                </div>
            </div>

            <p class="mt-3 text-xs text-gray-600">{{ light(subjects_json.length ? 'Subjects configured' : 'No subjects') }}</p>
        </div>

        <div>
            <h3 class="mb-3 text-base font-semibold text-gray-900">Image + HTML + Attr</h3>

            <div light:image="avatar_preview_url, avatar_url" class="mb-3 flex h-40 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50">
                <img light:src="avatar_preview_url" alt="Avatar Preview" class="h-full w-full object-contain" />
                <input type="file" name="avatar" accept=".png,.jpg,.jpeg,.webp" hidden />
            </div>

            <div class="mb-2 rounded border p-2 text-xs" light:html="rich_html"></div>

            <input
                type="text"
                light:model="rich_html"
                class="w-full rounded border px-2 py-1 text-xs"
                light:attr.disabled="showModal"
                placeholder="Write HTML string like &lt;em&gt;Hi&lt;/em&gt;"
            />
        </div>
    </section>

    <div light:if="showModal" class="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div class="absolute inset-0 bg-black/40" light:function="showModal=false"></div>

        <div class="relative z-10 w-full max-w-md rounded-xl bg-white shadow-xl" light:class="{'ring-2 ring-indigo-400': showModal}">
            <div class="border-b px-5 py-4">
                <h2 class="font-semibold text-gray-900">{{ light(editingId ? 'Edit User' : 'Create User') }}</h2>
            </div>

            <form light:submit="saveUser" class="space-y-3 px-5 py-4">
                <input type="hidden" light:model="editingId" />

                <div>
                    <label class="mb-1 block text-xs font-semibold text-gray-700">Name</label>
                    <input light:model="name" light:rules="required|min:3|max:100" class="w-full rounded border px-3 py-2 text-sm" />
                    <span light:error="name" class="mt-1 block text-xs text-rose-600"></span>
                </div>

                <div>
                    <label class="mb-1 block text-xs font-semibold text-gray-700">Email</label>
                    <input type="email" light:model="email" light:rules="required|email" class="w-full rounded border px-3 py-2 text-sm" />
                    <span light:error="email" class="mt-1 block text-xs text-rose-600"></span>
                </div>

                <div>
                    <label class="mb-1 block text-xs font-semibold text-gray-700">Password</label>
                    <input type="password" light:model="password" light:rules="required|min:6" class="w-full rounded border px-3 py-2 text-sm" />
                    <span light:error="password" class="mt-1 block text-xs text-rose-600"></span>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="button" light:function="showModal=false" class="flex-1 rounded border px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
                    <button
                        type="submit"
                        class="flex-1 rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                        light:attr.disabled="!name || !email || !password"
                    >
                        <span light:loading light:loading.target="saveUser">Saving...</span>
                        <span light:loading.remove>{{ light(editingId ? 'Update' : 'Create') }}</span>
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>
