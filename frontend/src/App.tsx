import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { CartProvider } from './cart/CartContext';
import { Layout } from './components/Layout';
import { AccountPage } from './pages/AccountPage';
import { BusinessPage } from './pages/BusinessPage';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { LoginPage } from './pages/LoginPage';
import { MyOrdersPage } from './pages/MyOrdersPage';
import { OrderConfirmationPage } from './pages/OrderConfirmationPage';
import { RegisterPage } from './pages/RegisterPage';
import { AdminActivityPage } from './pages/admin/AdminActivityPage';
import { AdminBusinessesPage } from './pages/admin/AdminBusinessesPage';
import { AdminCategoriesPage } from './pages/admin/AdminCategoriesPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminPlacesPage } from './pages/admin/AdminPlacesPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';

export function App() {
  return (
    <AuthProvider>
      <CartProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<CatalogPage />} />
          <Route path="negocios/:id" element={<BusinessPage />} />
          <Route path="carrito" element={<CartPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="pedido/:id" element={<OrderConfirmationPage />} />

          <Route path="entrar" element={<LoginPage />} />
          <Route path="registro" element={<RegisterPage />} />
          <Route path="mis-pedidos" element={<MyOrdersPage />} />
          <Route path="cuenta" element={<AccountPage />} />

          <Route path="admin/login" element={<AdminLoginPage />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/pedidos" replace />} />
            <Route path="dashboard" element={<AdminDashboardPage />} />
            <Route path="pedidos" element={<AdminOrdersPage />} />
            <Route path="negocios" element={<AdminBusinessesPage />} />
            <Route path="productos" element={<AdminProductsPage />} />
            <Route path="categorias" element={<AdminCategoriesPage />} />
            <Route path="lugares" element={<AdminPlacesPage />} />
            <Route path="usuarios" element={<AdminUsersPage />} />
            <Route path="historial" element={<AdminActivityPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </CartProvider>
    </AuthProvider>
  );
}
