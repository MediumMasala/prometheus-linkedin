import React, { useState, useEffect } from 'react';
import { useAuth, type UserRole } from '../contexts/AuthContext';
import { authFetch } from '../contexts/AuthContext';

interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  createdBy: string;
  lastLogin?: string;
}

interface UserStats {
  total: number;
  admins: number;
  viewers: number;
}

export function Settings() {
  const { user: currentUser, isAdmin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('viewer');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadUsers = async () => {
    if (!isAdmin) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await authFetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
        setStats(data.stats);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to load users');
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [isAdmin]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          role: newRole,
        }),
      });

      if (response.ok) {
        setNewEmail('');
        setNewPassword('');
        setNewRole('viewer');
        setShowAddForm(false);
        loadUsers();
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to add user');
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      const response = await authFetch(`/api/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (response.ok) {
        loadUsers();
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to update role');
      }
    } catch (e) {
      setError('Network error');
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Are you sure you want to delete ${email}?`)) return;

    try {
      const response = await authFetch(`/api/users/${userId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadUsers();
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to delete user');
      }
    } catch (e) {
      setError('Network error');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Admin Access Required</h3>
          <p className="text-gray-500">You don't have permission to access settings.</p>
          <p className="text-gray-400 text-sm mt-2">Logged in as: {currentUser?.email} ({currentUser?.role})</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="text-gray-500">Manage users and access</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total Users</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Admins</p>
            <p className="text-2xl font-bold text-orange-600">{stats.admins}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Viewers</p>
            <p className="text-2xl font-bold text-blue-600">{stats.viewers}</p>
          </div>
        </div>
      )}

      {/* User Management */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">User Management</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-1.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add User
          </button>
        </div>

        {/* Add User Form */}
        {showAddForm && (
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="user@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="Min 6 characters"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  >
                    <option value="viewer">Viewer (Read Only)</option>
                    <option value="admin">Admin (Full Access)</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Adding...' : 'Add User'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 text-gray-600 text-sm font-medium hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Users List */}
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading users...</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {users.map((user) => (
              <div key={user.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    user.role === 'admin' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {user.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{user.email}</p>
                      {user.id === currentUser?.id && (
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">You</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Added {formatDate(user.createdAt)}
                      {user.lastLogin && ` • Last login ${formatDate(user.lastLogin)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                    disabled={user.id === currentUser?.id}
                    className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                  {user.id !== currentUser?.id && (
                    <button
                      onClick={() => handleDeleteUser(user.id, user.email)}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete user"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Role Permissions Info */}
      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="font-medium text-gray-900 mb-3">Role Permissions</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-orange-50 rounded-lg">
            <p className="font-medium text-orange-700">Admin</p>
            <ul className="mt-1 text-orange-600 space-y-1">
              <li>• View all dashboards</li>
              <li>• Manage users</li>
              <li>• Approve/reject mappings</li>
              <li>• Access settings</li>
            </ul>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <p className="font-medium text-blue-700">Viewer</p>
            <ul className="mt-1 text-blue-600 space-y-1">
              <li>• View all dashboards</li>
              <li>• Read-only access</li>
              <li>• Cannot modify data</li>
              <li>• Cannot access settings</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
