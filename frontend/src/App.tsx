import { Navigate, Route, Routes } from 'react-router-dom';
import { CartProvider } from './cart/CartContext';
import { Layout } from './components/Layout';
import { BusinessPage } from './pages/BusinessPage';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderConfirmationPage } from './pages/OrderConfirmationPage';
import { AdminBusinessesPage } from './pages/admin/AdminBusinessesPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';

export function App() {
  return (
    <CartProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<CatalogPage />} />
          <Route path="negocios/:id" element={<BusinessPage />} />
          <Route path="carrito" element={<CartPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="pedido/:id" element={<OrderConfirmationPage />} />

          <Route path="admin/login" element={<AdminLoginPage />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/pedidos" replace />} />
            <Route path="pedidos" element={<AdminOrdersPage />} />
            <Route path="negocios" element={<AdminBusinessesPage />} />
            <Route path="productos" element={<AdminProductsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CartProvider>
  );
}
