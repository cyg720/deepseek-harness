package com.qs.authority.common.support;

import java.net.InetAddress;
import java.net.UnknownHostException;

/**
 * 服务账号 IP 白名单元素校验：必须是真实可解析的 IPv4 或 IPv6 地址，或带合法前缀长度的网段。
 *
 * <p>校验逐段解析数值并检查范围，不做正则外观匹配，因此 {@code 999.999.999.999/99} 这类“看起来
 * 像地址”的输入会被拒绝。IPv6 只接受字面量（含冒号的字符串不会触发域名解析），前缀长度限定在
 * 0 至 128。
 */
public final class IpRules {

    private static final int IPV4_SEGMENTS = 4;
    private static final int IPV4_MAX_OCTET = 255;
    private static final int IPV4_MAX_PREFIX = 32;
    private static final int IPV6_MAX_PREFIX = 128;

    private IpRules() {
    }

    /**
     * 判断是否为可用的白名单元素。
     *
     * @param value 元素文本，可为 null
     * @return 合法 IPv4、IPv6 地址或网段时为 true
     */
    public static boolean isAddressOrCidr(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        String trimmed = value.trim();
        int slash = trimmed.indexOf('/');
        if (slash != trimmed.lastIndexOf('/')) {
            return false;
        }
        String host = slash < 0 ? trimmed : trimmed.substring(0, slash);
        String prefix = slash < 0 ? null : trimmed.substring(slash + 1);
        if (host.isEmpty() || prefix != null && prefix.isEmpty()) {
            return false;
        }
        return host.contains(":") ? isIpv6(host, prefix) : isIpv4(host, prefix);
    }

    private static boolean isIpv4(String host, String prefix) {
        String[] segments = host.split("\\.", -1);
        if (segments.length != IPV4_SEGMENTS) {
            return false;
        }
        for (String segment : segments) {
            if (!isDecimalOctet(segment)) {
                return false;
            }
        }
        return isPrefixInRange(prefix, IPV4_MAX_PREFIX);
    }

    private static boolean isDecimalOctet(String segment) {
        if (segment.isEmpty() || segment.length() > 3) {
            return false;
        }
        if (segment.length() > 1 && segment.charAt(0) == '0') {
            return false;
        }
        for (int index = 0; index < segment.length(); index++) {
            if (!Character.isDigit(segment.charAt(index))) {
                return false;
            }
        }
        return Integer.parseInt(segment) <= IPV4_MAX_OCTET;
    }

    private static boolean isIpv6(String host, String prefix) {
        if (!isPrefixInRange(prefix, IPV6_MAX_PREFIX)) {
            return false;
        }
        try {
            // 含冒号的字符串按 IPv6 字面量解析，不会触发域名查询；解析失败即拒绝。
            InetAddress parsed = InetAddress.getByName(host);
            return parsed instanceof java.net.Inet6Address || parsed.getAddress().length == 16;
        } catch (UnknownHostException exception) {
            return false;
        }
    }

    private static boolean isPrefixInRange(String prefix, int max) {
        if (prefix == null) {
            return true;
        }
        if (prefix.isEmpty() || prefix.length() > 3) {
            return false;
        }
        for (int index = 0; index < prefix.length(); index++) {
            if (!Character.isDigit(prefix.charAt(index))) {
                return false;
            }
        }
        return Integer.parseInt(prefix) <= max;
    }
}
