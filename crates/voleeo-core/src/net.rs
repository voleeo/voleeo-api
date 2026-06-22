//! Network-target safety checks shared by the HTTP executor (SSRF guard) and
//! any caller that needs to refuse internal / cloud-metadata destinations.

use std::net::{IpAddr, Ipv6Addr};

/// True for addresses that are never a legitimate API target and are the classic
/// SSRF pivot: IPv4 link-local `169.254.0.0/16` (which contains the cloud metadata IP `169.254.169.254`),
/// IPv6 link-local `fe80::/10`, and the AWS IMDSv6 endpoint `fd00:ec2::254`. Loopback and private / LAN ranges are
/// allowed on purpose — local and staging API testing is a normal workflow.
pub fn is_link_local_or_metadata(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_link_local(),
        IpAddr::V6(v6) => {
            (v6.segments()[0] & 0xffc0) == 0xfe80
                || v6 == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn blocks_metadata_and_link_local() {
        assert!(is_link_local_or_metadata(
            Ipv4Addr::new(169, 254, 169, 254).into()
        ));
        assert!(is_link_local_or_metadata(
            Ipv4Addr::new(169, 254, 0, 1).into()
        ));
        assert!(is_link_local_or_metadata(
            "fe80::1".parse::<Ipv6Addr>().unwrap().into()
        ));
        assert!(is_link_local_or_metadata(
            Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254).into()
        ));
    }

    #[test]
    fn allows_loopback_private_and_public() {
        // localhost + LAN/staging must stay reachable for an API client.
        assert!(!is_link_local_or_metadata(Ipv4Addr::LOCALHOST.into()));
        assert!(!is_link_local_or_metadata(
            Ipv4Addr::new(10, 0, 0, 5).into()
        ));
        assert!(!is_link_local_or_metadata(
            Ipv4Addr::new(192, 168, 1, 10).into()
        ));
        assert!(!is_link_local_or_metadata(Ipv4Addr::new(8, 8, 8, 8).into()));
        assert!(!is_link_local_or_metadata(Ipv6Addr::LOCALHOST.into()));
    }
}
